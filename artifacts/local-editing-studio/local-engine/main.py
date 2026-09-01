from __future__ import annotations

import asyncio
import importlib.util
import json
import math
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

ROOT = Path(__file__).resolve().parent


def default_data_dir() -> Path:
    configured = os.environ.get("LOCAL_EDITING_ENGINE_DATA")
    if configured:
        return Path(configured).expanduser().resolve()
    if os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        return Path(os.environ["LOCALAPPDATA"]) / "LocalEditingStudio" / "EngineData"
    return ROOT / "data"


DATA = default_data_dir()
ASSETS = DATA / "assets"
JOBS = DATA / "jobs"
TOKEN_FILE = DATA / "pairing-token.txt"
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
RANGE_RE = re.compile(r"^bytes (\d+)-(\d+)/(\d+)$")
MAX_ASSET_BYTES = 500 * 1024**3

ASSETS.mkdir(parents=True, exist_ok=True)
JOBS.mkdir(parents=True, exist_ok=True)


def pairing_token() -> str:
    """Create once locally; never return the secret through an HTTP endpoint."""
    if TOKEN_FILE.is_file():
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
        if len(token) >= 32:
            return token
    token = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(token + "\n", encoding="utf-8")
    try:
        os.chmod(TOKEN_FILE, 0o600)
    except OSError:
        pass
    return token


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def valid_id(value: str, label: str = "id") -> str:
    if not ID_RE.fullmatch(value) or value in {".", ".."}:
        raise HTTPException(400, f"Invalid {label}")
    return value


def atomic_json(path: Path, value: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def asset_dir(asset_id: str) -> Path:
    return ASSETS / valid_id(asset_id, "asset id")


def asset_meta(asset_id: str, require_complete: bool = True) -> tuple[dict[str, Any], Path]:
    folder = asset_dir(asset_id)
    meta = load_json(folder / "metadata.json")
    media = folder / "media"
    if not meta or not media.is_file():
        raise HTTPException(404, f"Asset '{asset_id}' was not found")
    if require_complete and not meta.get("complete"):
        raise HTTPException(409, f"Asset '{asset_id}' upload is incomplete")
    return meta, media


class AssetInit(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0, le=MAX_ASSET_BYTES)
    mime_type: str | None = Field(default=None, max_length=200)
    overwrite: bool = False

    @field_validator("filename")
    @classmethod
    def safe_filename(cls, value: str) -> str:
        value = Path(value.replace("\\", "/")).name
        if not value or value in {".", ".."} or "\x00" in value:
            raise ValueError("Invalid filename")
        return value


class AnalysisRequest(BaseModel):
    asset_ids: list[str] = Field(min_length=1, max_length=100)
    model: str = Field(default="small", pattern=r"^[A-Za-z0-9_.-]{1,80}$")
    language: Literal["ar", "en", "auto"] = "auto"
    device: Literal["auto", "cuda", "cpu"] = "auto"

    @field_validator("asset_ids")
    @classmethod
    def ids_valid(cls, values: list[str]) -> list[str]:
        if len(set(values)) != len(values):
            raise ValueError("asset_ids must be unique")
        for value in values:
            if not ID_RE.fullmatch(value):
                raise ValueError(f"Invalid asset id: {value}")
        return values


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    plan: dict[str, Any]
    width: int = Field(default=1920, ge=320, le=3840)
    height: int = Field(default=1080, ge=240, le=2160)
    fps: int = Field(default=30, ge=1, le=60)
    video_bitrate: str = Field(default="12M", pattern=r"^\d+[kKmM]$")
    encoder: Literal["auto", "libx264", "h264_nvenc"] = "auto"


class CleanupRequest(BaseModel):
    older_than_days: int | None = Field(default=None, ge=1, le=3650)
    max_bytes: int | None = Field(default=None, ge=0)


class JobRegistry:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.cancel_events: dict[str, threading.Event] = {}
        self.processes: dict[str, subprocess.Popen[str]] = {}

    def path(self, job_id: str) -> Path:
        return JOBS / valid_id(job_id, "job id")

    def read(self, job_id: str) -> dict[str, Any]:
        job = load_json(self.path(job_id) / "job.json")
        if not job:
            raise HTTPException(404, "Job not found")
        return job

    def write(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self.lock:
            path = self.path(job_id) / "job.json"
            job = load_json(path)
            job.update(changes)
            job["updated_at"] = utcnow()
            atomic_json(path, job)
            return job

    def create(self, kind: str, request: dict[str, Any]) -> tuple[str, threading.Event]:
        job_id = uuid.uuid4().hex
        folder = self.path(job_id)
        (folder / "output").mkdir(parents=True)
        atomic_json(folder / "request.json", request)
        event = threading.Event()
        self.cancel_events[job_id] = event
        self.write(
            job_id,
            id=job_id,
            kind=kind,
            status="queued",
            progress=0,
            message="Queued",
            created_at=utcnow(),
            error=None,
        )
        return job_id, event

    def check_cancelled(self, job_id: str) -> None:
        event = self.cancel_events.get(job_id)
        if event and event.is_set():
            raise JobCancelled()

    def run_process(self, job_id: str, command: list[str]) -> tuple[str, str]:
        self.check_cancelled(job_id)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        log_dir = self.path(job_id) / "work"
        log_dir.mkdir(exist_ok=True)
        stdout_fd, stdout_name = tempfile.mkstemp(prefix="stdout-", suffix=".log", dir=log_dir)
        stderr_fd, stderr_name = tempfile.mkstemp(prefix="stderr-", suffix=".log", dir=log_dir)
        os.close(stdout_fd)
        os.close(stderr_fd)
        stdout_path = Path(stdout_name)
        stderr_path = Path(stderr_name)
        # Files, rather than unread pipes, prevent a verbose FFmpeg process from
        # blocking when its OS pipe buffer fills.
        stdout_handle = stdout_path.open("w", encoding="utf-8", errors="replace")
        stderr_handle = stderr_path.open("w", encoding="utf-8", errors="replace")
        process = subprocess.Popen(
            command,
            stdout=stdout_handle,
            stderr=stderr_handle,
            creationflags=flags,
        )
        with self.lock:
            self.processes[job_id] = process
        try:
            while process.poll() is None:
                if self.cancel_events.get(job_id, threading.Event()).is_set():
                    process.terminate()
                    try:
                        process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        process.kill()
                    raise JobCancelled()
                time.sleep(0.15)
            process.wait()
            stdout_handle.close()
            stderr_handle.close()
            # Bound returned data: callers only need ffprobe JSON and FFmpeg's
            # recent diagnostics, while complete logs remain temporary files.
            stdout = stdout_path.read_text(encoding="utf-8", errors="replace")[-1_000_000:]
            stderr = stderr_path.read_text(encoding="utf-8", errors="replace")[-1_000_000:]
            # cancel() may terminate the process before this polling loop sees
            # the event. Preserve the requested terminal state instead of
            # incorrectly reporting a terminated FFmpeg process as a failure.
            self.check_cancelled(job_id)
            if process.returncode:
                tail = "\n".join(stderr.strip().splitlines()[-20:])
                raise RuntimeError(f"Command failed ({process.returncode}): {tail}")
            return stdout, stderr
        finally:
            if not stdout_handle.closed:
                stdout_handle.close()
            if not stderr_handle.closed:
                stderr_handle.close()
            with self.lock:
                self.processes.pop(job_id, None)
            # Windows can retain a terminated process's redirected file handles
            # for a few scheduler ticks after wait() returns. Retry that transient
            # sharing violation so cancellation is not reported as a test failure.
            for log_path in (stdout_path, stderr_path):
                for attempt in range(20):
                    try:
                        log_path.unlink(missing_ok=True)
                        break
                    except PermissionError:
                        if attempt == 19:
                            # A Windows antivirus/indexer can keep a redirected
                            # log open after the child has exited. Do not mask
                            # the process result or cancellation contract; the
                            # scheduled job cleanup will remove this log later.
                            break
                        time.sleep(0.05)

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self.read(job_id)
        if job["status"] in {"completed", "failed", "cancelled"}:
            return job
        event = self.cancel_events.setdefault(job_id, threading.Event())
        event.set()
        with self.lock:
            process = self.processes.get(job_id)
            if process and process.poll() is None:
                process.terminate()
        return self.write(job_id, status="cancelling", message="Cancellation requested")


class JobCancelled(Exception):
    pass


registry = JobRegistry()
asset_locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
background_tasks: set[asyncio.Task[None]] = set()
storage_lock = threading.RLock()

ACTIVE_STATUSES = {"queued", "running", "cancelling"}


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return total
    for item in path.rglob("*"):
        try:
            if item.is_file():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def job_asset_ids(folder: Path) -> set[str]:
    request = load_json(folder / "request.json")
    found: set[str] = set()

    def visit(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                visit(child, child_key)
        elif isinstance(value, list):
            for child in value:
                visit(child, key)
        elif isinstance(value, str) and key in {"asset_id", "assetId", "asset_ids"}:
            if ID_RE.fullmatch(value):
                found.add(value)

    visit(request)
    return found


def storage_snapshot() -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    assets: list[dict[str, Any]] = []
    active_assets: set[str] = set()
    for folder in JOBS.iterdir():
        if not folder.is_dir():
            continue
        job = load_json(folder / "job.json")
        if not job:
            continue
        asset_ids = job_asset_ids(folder)
        if job.get("status") in ACTIVE_STATUSES:
            active_assets.update(asset_ids)
        jobs.append({
            "id": folder.name,
            "kind": job.get("kind"),
            "status": job.get("status"),
            "created_at": job.get("created_at"),
            "updated_at": job.get("updated_at"),
            "size": directory_size(folder),
            "asset_ids": sorted(asset_ids),
            "deletable": job.get("status") not in ACTIVE_STATUSES,
        })
    for folder in ASSETS.iterdir():
        if not folder.is_dir():
            continue
        meta = load_json(folder / "metadata.json")
        assets.append({
            "id": folder.name,
            "filename": meta.get("filename") or folder.name,
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "size": directory_size(folder),
            "in_use": folder.name in active_assets,
            "deletable": folder.name not in active_assets,
        })
    jobs.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    assets.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return {
        "assets_bytes": sum(item["size"] for item in assets),
        "jobs_bytes": sum(item["size"] for item in jobs),
        "total_bytes": sum(item["size"] for item in assets + jobs),
        "assets": assets,
        "jobs": jobs,
    }


def parse_timestamp(value: Any) -> float:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0


def executable_version(name: str) -> dict[str, Any]:
    path = shutil.which(name)
    if not path:
        return {"available": False, "path": None, "version": None}
    try:
        result = subprocess.run(
            [path, "-version"], capture_output=True, text=True, timeout=5,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        first = (result.stdout or result.stderr).splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError):
        first = None
    return {"available": True, "path": path, "version": first}


def hardware_status() -> dict[str, Any]:
    cuda = False
    cuda_devices = 0
    error = None
    try:
        import ctranslate2
        cuda_devices = ctranslate2.get_cuda_device_count()
        cuda = cuda_devices > 0
    except Exception as exc:
        error = str(exc)
    nvidia = shutil.which("nvidia-smi")
    gpus: list[str] = []
    if nvidia:
        try:
            result = subprocess.run(
                [nvidia, "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            gpus = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        except (OSError, subprocess.SubprocessError):
            pass
    return {
        "cuda_available": cuda,
        "cuda_device_count": cuda_devices,
        "nvidia_gpus": gpus,
        "rtx_available": any("RTX" in gpu.upper() for gpu in gpus),
        "probe_error": error,
    }


_nvenc_lock = threading.Lock()
_nvenc_cache: dict[str, Any] = {"checked_at": 0.0, "usable": False, "error": "Not checked"}


def nvenc_status() -> dict[str, Any]:
    """Test an actual one-frame NVENC encode, not merely encoder enumeration."""
    global _nvenc_cache
    with _nvenc_lock:
        if time.monotonic() - _nvenc_cache["checked_at"] < 30:
            return dict(_nvenc_cache)
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            _nvenc_cache = {"checked_at": time.monotonic(), "usable": False,
                            "error": "ffmpeg was not found"}
            return dict(_nvenc_cache)
        try:
            result = subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
                 "-f", "lavfi", "-i", "color=c=black:s=64x64:r=1", "-frames:v", "1",
                 "-c:v", "h264_nvenc", "-f", "null", "-"],
                capture_output=True, text=True, timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            _nvenc_cache = {
                "checked_at": time.monotonic(), "usable": result.returncode == 0,
                "error": None if result.returncode == 0 else
                "\n".join((result.stderr or result.stdout).strip().splitlines()[-5:]),
            }
        except (OSError, subprocess.SubprocessError) as exc:
            _nvenc_cache = {"checked_at": time.monotonic(), "usable": False, "error": str(exc)}
        return dict(_nvenc_cache)


def probe_media(job_id: str, path: Path) -> dict[str, Any]:
    stdout, _ = registry.run_process(job_id, [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=index,codec_type,width,height",
        "-of", "json", str(path),
    ])
    data = json.loads(stdout)
    streams = data.get("streams", [])
    return {
        "duration": float(data.get("format", {}).get("duration") or 0),
        "has_video": any(s.get("codec_type") == "video" for s in streams),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def detect_silence(job_id: str, path: Path, duration: float) -> list[dict[str, float]]:
    _, stderr = registry.run_process(job_id, [
        "ffmpeg", "-hide_banner", "-nostdin", "-i", str(path),
        "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-",
    ])
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", stderr)]
    ends = [(float(a), float(b)) for a, b in re.findall(
        r"silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)", stderr
    )]
    result: list[dict[str, float]] = []
    for index, start in enumerate(starts):
        if index < len(ends):
            end, silence_duration = ends[index]
        else:
            end, silence_duration = duration, max(0, duration - start)
        result.append({"start": round(start, 3), "end": round(end, 3),
                       "duration": round(silence_duration, 3)})
    return result


ARABIC_MARKS = re.compile(r"[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]")
NON_WORD = re.compile(r"[^\w\u0600-\u06ff]+", re.UNICODE)


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).lower()
    text = ARABIC_MARKS.sub("", text)
    text = text.translate(str.maketrans("أإآىةؤئ", "ااايهوء"))
    return " ".join(NON_WORD.sub(" ", text).split())


def repeated_phrases(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    occurrences: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for segment in segments:
        words = normalize_text(segment["text"]).split()
        seen: set[str] = set()
        for size in range(min(8, len(words)), 2, -1):
            for i in range(len(words) - size + 1):
                phrase = " ".join(words[i:i + size])
                if phrase not in seen:
                    occurrences[phrase].append({
                        "asset_id": segment["asset_id"],
                        "segment_id": segment["id"],
                        "start": segment["start"],
                        "end": segment["end"],
                    })
                    seen.add(phrase)
    candidates = [(phrase, spots) for phrase, spots in occurrences.items() if len(spots) > 1]
    candidates.sort(key=lambda item: (-len(item[0].split()), -len(item[1]), item[0]))
    selected: list[dict[str, Any]] = []
    covered: set[tuple[str, str]] = set()
    for phrase, spots in candidates:
        signature = {(spot["asset_id"], spot["segment_id"]) for spot in spots}
        if signature <= covered:
            continue
        selected.append({"phrase": phrase, "count": len(spots), "occurrences": spots})
        covered.update(signature)
        if len(selected) >= 100:
            break
    return selected


def overlap_duration(start: float, end: float, ranges: list[dict[str, float]]) -> float:
    return sum(max(0.0, min(end, r["end"]) - max(start, r["start"])) for r in ranges)


def make_takes(segments: list[dict[str, Any]], silences: dict[str, list[dict[str, float]]],
               repeats: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    repeated_ids: dict[str, str] = {}
    for group in repeats:
        for occurrence in group["occurrences"]:
            repeated_ids[occurrence["segment_id"]] = group["phrase"]
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for segment in segments:
        key = repeated_ids.get(segment["id"], f"unique:{segment['id']}")
        grouped[key].append(segment)

    takes: list[dict[str, Any]] = []
    timeline_candidates: list[dict[str, Any]] = []
    for group_id, members in grouped.items():
        ranked: list[dict[str, Any]] = []
        for segment in members:
            duration = max(0.001, segment["end"] - segment["start"])
            silence_ratio = min(1.0, overlap_duration(
                segment["start"], segment["end"], silences.get(segment["asset_id"], [])
            ) / duration)
            probability = segment.get("average_word_probability", 0.5)
            score = max(0.0, min(100.0, 65 * probability + 35 * (1 - silence_ratio)))
            reasons = [
                f"Average word confidence {probability:.0%}",
                f"Silence inside take {silence_ratio:.0%}",
            ]
            if group_id.startswith("unique:"):
                reasons.append("Unique phrase; no repeated take detected")
            else:
                reasons.append(f"Alternative recording of repeated phrase: {group_id}")
            take = {
                "id": f"take-{segment['id']}",
                "group_id": group_id,
                "asset_id": segment["asset_id"],
                "start": segment["start"],
                "end": segment["end"],
                "text": segment["text"],
                "score": round(score, 2),
                "rating": max(1, min(5, math.ceil(score / 20))),
                "rank": 0,
                "selected": False,
                "reasons": reasons,
            }
            ranked.append(take)
        ranked.sort(key=lambda take: (-take["score"], take["asset_id"], take["start"]))
        for rank, take in enumerate(ranked, 1):
            take["rank"] = rank
            take["selected"] = rank == 1
            if rank == 1 and len(ranked) > 1:
                take["reasons"].append("Highest score among repeated alternatives")
            takes.append(take)
        timeline_candidates.append(ranked[0])

    asset_order = {asset_id: i for i, asset_id in enumerate(dict.fromkeys(
        segment["asset_id"] for segment in segments
    ))}
    timeline_candidates.sort(key=lambda take: (asset_order[take["asset_id"]], take["start"]))
    timeline = [{
        "id": f"timeline-{index + 1}",
        "take_id": take["id"],
        "asset_id": take["asset_id"],
        "start": take["start"],
        "end": take["end"],
        "text": take["text"],
        "order": index,
    } for index, take in enumerate(timeline_candidates)]
    return takes, timeline


def run_analysis(job_id: str, request: AnalysisRequest) -> None:
    registry.write(job_id, status="running", progress=2, message="Loading transcription model")
    try:
        from faster_whisper import WhisperModel

        hw = hardware_status()
        device = request.device
        if device == "auto":
            device = "cuda" if hw["cuda_available"] else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        model = WhisperModel(request.model, device=device, compute_type=compute_type)
        all_segments: list[dict[str, Any]] = []
        silence_by_asset: dict[str, list[dict[str, float]]] = {}
        media_info: dict[str, Any] = {}
        total = len(request.asset_ids)
        for index, asset_id in enumerate(request.asset_ids):
            registry.check_cancelled(job_id)
            meta, path = asset_meta(asset_id)
            info = probe_media(job_id, path)
            if not info["has_audio"]:
                raise RuntimeError(f"Asset '{asset_id}' has no audio stream to transcribe")
            media_info[asset_id] = {**info, "filename": meta["filename"]}
            registry.write(job_id, progress=5 + int(index / total * 80),
                           message=f"Analyzing {meta['filename']}")
            silence_by_asset[asset_id] = detect_silence(job_id, path, info["duration"])
            language = None if request.language == "auto" else request.language
            segment_iterator, transcription_info = model.transcribe(
                str(path), language=language, word_timestamps=True, vad_filter=True,
                condition_on_previous_text=True,
            )
            for segment_index, segment in enumerate(segment_iterator):
                registry.check_cancelled(job_id)
                words = [{
                    "start": round(float(word.start), 3),
                    "end": round(float(word.end), 3),
                    "word": word.word,
                    "probability": round(float(word.probability), 5),
                } for word in (segment.words or [])]
                probabilities = [word["probability"] for word in words]
                all_segments.append({
                    "id": f"{asset_id}-segment-{segment_index + 1}",
                    "asset_id": asset_id,
                    "start": round(float(segment.start), 3),
                    "end": round(float(segment.end), 3),
                    "text": segment.text.strip(),
                    "language": transcription_info.language,
                    "words": words,
                    "average_word_probability": round(
                        sum(probabilities) / len(probabilities), 5
                    ) if probabilities else 0.5,
                })
        registry.write(job_id, progress=90, message="Ranking takes and building timeline")
        repeats = repeated_phrases(all_segments)
        takes, timeline = make_takes(all_segments, silence_by_asset, repeats)
        result = {
            "job_id": job_id,
            "kind": "analysis",
            "model": request.model,
            "device": device,
            "assets": media_info,
            "segments": all_segments,
            "silences": silence_by_asset,
            "repeated_phrases": repeats,
            "takes": takes,
            "timeline": timeline,
        }
        atomic_json(registry.path(job_id) / "output" / "analysis.json", result)
        registry.write(job_id, status="completed", progress=100, message="Analysis complete",
                       files=["analysis.json"])
    except JobCancelled:
        registry.write(job_id, status="cancelled", message="Cancelled")
    except Exception as exc:
        registry.write(job_id, status="failed", message="Analysis failed", error=str(exc))


def resolve_timeline(plan: dict[str, Any]) -> list[dict[str, Any]]:
    raw_timeline = plan.get("timeline")
    if not isinstance(raw_timeline, list) or not raw_timeline:
        raise ValueError("plan.timeline must be a non-empty array")
    take_map = {
        str(take.get("id")): take for take in plan.get("takes", [])
        if isinstance(take, dict) and take.get("id")
    }
    resolved: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_timeline):
        if not isinstance(raw, dict):
            raise ValueError(f"timeline[{index}] must be an object")
        item = dict(take_map.get(str(raw.get("take_id") or raw.get("takeId")), {}))
        item.update(raw)
        asset_id = item.get("asset_id") or item.get("assetId")
        if not isinstance(asset_id, str) or not ID_RE.fullmatch(asset_id):
            raise ValueError(f"timeline[{index}] has an invalid asset_id")
        try:
            start, end = float(item["start"]), float(item["end"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"timeline[{index}] requires numeric start and end") from exc
        if start < 0 or end <= start:
            raise ValueError(f"timeline[{index}] has an invalid time range")
        resolved.append({
            "asset_id": asset_id, "start": start, "end": end,
            "text": str(item.get("text") or item.get("caption") or "").strip(),
            "order": int(item.get("order", index)),
        })
    resolved.sort(key=lambda item: item["order"])
    return resolved


def srt_timestamp(seconds: float) -> str:
    millis = max(0, round(seconds * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def run_render(job_id: str, request: RenderRequest) -> None:
    folder = registry.path(job_id)
    work = folder / "work"
    output = folder / "output"
    work.mkdir(exist_ok=True)
    try:
        if request.encoder == "h264_nvenc" and not nvenc_status()["usable"]:
            raise RuntimeError("h264_nvenc was requested but the NVENC encode probe failed")
        encoder = (
            request.encoder
            if request.encoder != "auto"
            else ("h264_nvenc" if nvenc_status()["usable"] else "libx264")
        )
        registry.write(job_id, status="running", progress=2, message="Validating edit plan",
                       encoder=encoder)
        timeline = resolve_timeline(request.plan)
        clips: list[Path] = []
        elapsed = 0.0
        captions: list[tuple[float, float, str]] = []
        for index, item in enumerate(timeline):
            registry.check_cancelled(job_id)
            _, source = asset_meta(item["asset_id"])
            info = probe_media(job_id, source)
            if not info["has_video"]:
                raise RuntimeError(f"Asset '{item['asset_id']}' has no video stream")
            if item["end"] > info["duration"] + 0.1:
                raise RuntimeError(
                    f"Timeline range exceeds duration of asset '{item['asset_id']}'"
                )
            duration = item["end"] - item["start"]
            clip = work / f"clip-{index:05}.mp4"
            command = [
                "ffmpeg", "-y", "-hide_banner", "-nostdin", "-ss", str(item["start"]),
                "-t", str(duration), "-i", str(source),
            ]
            if not info["has_audio"]:
                command += ["-f", "lavfi", "-t", str(duration), "-i",
                            "anullsrc=channel_layout=stereo:sample_rate=48000"]
            video_options = (
                ["-c:v", "h264_nvenc", "-preset", "p5", "-b:v", request.video_bitrate]
                if encoder == "h264_nvenc" else
                ["-c:v", "libx264", "-preset", "medium", "-b:v", request.video_bitrate]
            )
            command += [
                "-map", "0:v:0", "-map", "0:a:0" if info["has_audio"] else "1:a:0",
                "-vf", (
                    f"scale={request.width}:{request.height}:"
                    "force_original_aspect_ratio=decrease,"
                    f"pad={request.width}:{request.height}:(ow-iw)/2:(oh-ih)/2:black,"
                    f"fps={request.fps},setsar=1,format=yuv420p"
                ),
                "-af", "aresample=48000:async=1:first_pts=0",
                *video_options,
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                "-movflags", "+faststart", "-shortest", str(clip),
            ]
            registry.run_process(job_id, command)
            clips.append(clip)
            if item["text"]:
                captions.append((elapsed, elapsed + duration, item["text"]))
            elapsed += duration
            registry.write(job_id, progress=5 + int((index + 1) / len(timeline) * 80),
                           message=f"Rendered clip {index + 1} of {len(timeline)}")

        concat_file = work / "concat.txt"
        concat_file.write_text("".join(
            f"file '{clip.as_posix().replace(chr(39), chr(39) * 2)}'\n" for clip in clips
        ), encoding="utf-8")
        final_video = output / "video.mp4"
        registry.write(job_id, progress=90, message="Joining rendered clips")
        registry.run_process(job_id, [
            "ffmpeg", "-y", "-hide_banner", "-nostdin", "-f", "concat", "-safe", "0",
            "-i", str(concat_file), "-c", "copy", "-movflags", "+faststart", str(final_video),
        ])
        srt = "\n".join(
            f"{index}\n{srt_timestamp(start)} --> {srt_timestamp(end)}\n{text}\n"
            for index, (start, end, text) in enumerate(captions, 1)
        )
        (output / "captions.srt").write_text(srt, encoding="utf-8-sig")
        reopenable = {
            "schema_version": 1,
            "created_at": utcnow(),
            "encoder": encoder,
            "render_settings": request.model_dump(exclude={"plan"}),
            "plan": request.plan,
            "resolved_timeline": timeline,
        }
        atomic_json(output / "edit-plan.json", reopenable)
        registry.write(job_id, status="completed", progress=100, message="Render complete",
                       files=["video.mp4", "captions.srt", "edit-plan.json"])
    except JobCancelled:
        registry.write(job_id, status="cancelled", message="Cancelled")
    except Exception as exc:
        registry.write(job_id, status="failed", message="Render failed", error=str(exc))
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def execute_job(job_id: str, kind: str, request: BaseModel) -> None:
    loop = asyncio.get_running_loop()
    function = run_analysis if kind == "analysis" else run_render
    await loop.run_in_executor(None, function, job_id, request)


@asynccontextmanager
async def lifespan(_: FastAPI):
    for path in JOBS.glob("*/job.json"):
        job = load_json(path)
        if job.get("status") in {"queued", "running", "cancelling"}:
            registry.write(path.parent.name, status="failed", progress=job.get("progress", 0),
                           message="Interrupted by engine restart",
                           error="The engine restarted before this job completed; submit it again.")
    print("Local Editing Engine pairing token (keep private):")
    print(pairing_token())
    print("Send it in the X-Local-Engine-Token request header.")
    yield


app = FastAPI(
    title="Local Editing Studio Engine",
    version="1.0.0",
    description="Local-only transcription, analysis, and FFmpeg rendering service.",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://localhost:4173", "http://localhost:5173",
        "http://127.0.0.1:3000", "http://127.0.0.1:4173", "http://127.0.0.1:5173",
    ],
    allow_origin_regex=(
        r"^https?://((localhost|127\.0\.0\.1)(:\d{1,5})?|"
        r"(?:[a-z0-9-]+\.)+(replit\.dev|repl\.co))$"
    ),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Content-Range", "X-Filename", "X-Local-Engine-Token"],
)


@app.middleware("http")
async def require_pairing_token(request: Request, call_next: Any) -> Any:
    # OPTIONS is a browser CORS preflight, not an application resource request.
    if request.url.path == "/health" or request.method == "OPTIONS":
        return await call_next(request)
    supplied = request.headers.get("X-Local-Engine-Token", "")
    if not secrets.compare_digest(supplied, pairing_token()):
        from fastapi.responses import JSONResponse
        return JSONResponse(
            status_code=401,
            content={"detail": "A valid X-Local-Engine-Token is required."},
        )
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, Any]:
    ffmpeg = executable_version("ffmpeg")
    ffprobe = executable_version("ffprobe")
    return {
        "status": "ok" if ffmpeg["available"] and ffprobe["available"] else "degraded",
        "engine_version": app.version,
        "instance_id": os.environ.get("LOCAL_EDITING_ENGINE_INSTANCE", ""),
        "local_only": True,
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        "whisper": {
            "available": importlib.util.find_spec("faster_whisper") is not None,
            "implementation": "faster-whisper",
        },
        "hardware": hardware_status(),
        "h264_nvenc": nvenc_status(),
    }


@app.post("/assets/{asset_id}")
def initialize_asset(asset_id: str, body: AssetInit) -> dict[str, Any]:
    folder = asset_dir(asset_id)
    with storage_lock, asset_locks[asset_id]:
        existing = load_json(folder / "metadata.json")
        if existing and not body.overwrite:
            raise HTTPException(409, "Asset already exists; set overwrite=true to replace it")
        active_asset_ids = {
            asset["id"] for asset in storage_snapshot()["assets"] if asset["in_use"]
        }
        if body.overwrite and asset_id in active_asset_ids:
            raise HTTPException(409, "Asset is linked to a running job and cannot be replaced")
        if body.overwrite and folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "media").write_bytes(b"")
        meta = {
            "id": asset_id, "filename": body.filename, "size": body.size,
            "mime_type": body.mime_type, "received": 0, "complete": body.size == 0,
            "created_at": utcnow(), "updated_at": utcnow(),
        }
        atomic_json(folder / "metadata.json", meta)
    return meta


@app.put("/assets/{asset_id}")
async def upload_asset_chunk(
    asset_id: str,
    request: Request,
    content_range: str | None = Header(default=None),
) -> dict[str, Any]:
    match = RANGE_RE.fullmatch(content_range or "")
    if not match:
        raise HTTPException(400, "Content-Range must use: bytes START-END/TOTAL")
    start, end, total = map(int, match.groups())
    expected = end - start + 1
    if expected > 64 * 1024**2:
        raise HTTPException(413, "Chunk exceeds 64 MiB")
    body = await request.body()
    if len(body) != expected or end < start or end >= total:
        raise HTTPException(400, "Chunk byte length or range is invalid")
    folder = asset_dir(asset_id)
    path = folder / "media"
    with storage_lock, asset_locks[asset_id]:
        meta = load_json(folder / "metadata.json")
        if not meta or not path.exists():
            raise HTTPException(404, "Initialize the asset before uploading bytes")
        if meta.get("complete"):
            raise HTTPException(409, "Asset upload is already complete")
        if total != meta["size"] or start != meta["received"]:
            raise HTTPException(
                409, "Chunk range does not match the expected offset or asset size"
            )
        with path.open("r+b") as stream:
            stream.seek(start)
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
        meta["received"] = end + 1
        meta["complete"] = meta["received"] == total
        meta["updated_at"] = utcnow()
        atomic_json(folder / "metadata.json", meta)
    return meta


@app.get("/assets/{asset_id}")
def get_asset(asset_id: str) -> dict[str, Any]:
    meta, _ = asset_meta(asset_id, require_complete=False)
    return meta


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: str) -> dict[str, bool]:
    folder = asset_dir(asset_id)
    with storage_lock, asset_locks[asset_id]:
        if not folder.exists():
            raise HTTPException(404, "Asset not found")
        snapshot = storage_snapshot()
        asset = next((item for item in snapshot["assets"] if item["id"] == asset_id), None)
        if asset and asset["in_use"]:
            raise HTTPException(409, "Asset is linked to a running job and cannot be deleted")
        shutil.rmtree(folder)
    return {"deleted": True}


@app.get("/storage")
def get_storage() -> dict[str, Any]:
    with storage_lock:
        return storage_snapshot()


@app.delete("/storage/jobs/{job_id}")
def delete_stored_job(job_id: str) -> dict[str, bool]:
    with storage_lock:
        job = registry.read(job_id)
        if job.get("status") in ACTIVE_STATUSES:
            raise HTTPException(409, "A running job cannot be deleted; cancel it first")
        shutil.rmtree(registry.path(job_id))
        registry.cancel_events.pop(job_id, None)
    return {"deleted": True}


@app.post("/storage/cleanup")
def cleanup_storage(body: CleanupRequest) -> dict[str, Any]:
    if body.older_than_days is None and body.max_bytes is None:
        raise HTTPException(422, "Choose an age or space limit")
    with storage_lock:
        snapshot = storage_snapshot()
        deleted_jobs: list[str] = []
        deleted_assets: list[str] = []
        failures: list[dict[str, str]] = []
        cutoff = time.time() - body.older_than_days * 86400 if body.older_than_days else None

        candidates: list[tuple[float, str, str, int]] = []
        for job in snapshot["jobs"]:
            if job["deletable"]:
                candidates.append((parse_timestamp(job["updated_at"]), "job", job["id"], job["size"]))
        for asset in snapshot["assets"]:
            if asset["deletable"]:
                candidates.append((parse_timestamp(asset["updated_at"]), "asset", asset["id"], asset["size"]))
        candidates.sort()

        total = snapshot["total_bytes"]
        for updated_at, kind, item_id, size in candidates:
            remove_for_age = cutoff is not None and updated_at < cutoff
            remove_for_space = body.max_bytes is not None and total > body.max_bytes
            if not remove_for_age and not remove_for_space:
                continue
            folder = registry.path(item_id) if kind == "job" else asset_dir(item_id)
            try:
                shutil.rmtree(folder)
            except OSError as exc:
                failures.append({"id": item_id, "kind": kind, "error": str(exc)})
                continue
            total = max(0, total - size)
            (deleted_jobs if kind == "job" else deleted_assets).append(item_id)
        after = storage_snapshot()
    return {
        "deleted_jobs": deleted_jobs,
        "deleted_assets": deleted_assets,
        "failures": failures,
        "freed_bytes": max(0, snapshot["total_bytes"] - after["total_bytes"]),
        "storage": after,
    }


@app.post("/jobs/analysis", status_code=202)
async def create_analysis_job(body: AnalysisRequest) -> dict[str, Any]:
    with storage_lock:
        for asset_id in body.asset_ids:
            asset_meta(asset_id)
        job_id, _ = registry.create("analysis", body.model_dump())
    task = asyncio.create_task(execute_job(job_id, "analysis", body))
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    return registry.read(job_id)


@app.post("/jobs/render", status_code=202)
async def create_render_job(body: RenderRequest) -> dict[str, Any]:
    try:
        timeline = resolve_timeline(body.plan)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    with storage_lock:
        for item in timeline:
            asset_meta(item["asset_id"])
        job_id, _ = registry.create("render", body.model_dump())
    task = asyncio.create_task(execute_job(job_id, "render", body))
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)
    return registry.read(job_id)


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    return registry.read(job_id)


@app.get("/jobs/{job_id}/result")
def get_job_result(job_id: str) -> dict[str, Any]:
    job = registry.read(job_id)
    if job["status"] != "completed":
        raise HTTPException(409, f"Job is {job['status']}")
    if job["kind"] == "analysis":
        return load_json(registry.path(job_id) / "output" / "analysis.json")
    return {
        "job_id": job_id,
        "kind": "render",
        "encoder": job.get("encoder"),
        "files": [{
            "name": name,
            "download_url": f"/jobs/{job_id}/files/{name}",
        } for name in job.get("files", [])],
    }


@app.get("/jobs/{job_id}/files/{filename}")
def download_job_file(job_id: str, filename: str) -> FileResponse:
    job = registry.read(job_id)
    if job["status"] != "completed":
        raise HTTPException(409, "Job is not complete")
    if not ID_RE.fullmatch(filename) or filename not in job.get("files", []):
        raise HTTPException(404, "Output file not found")
    path = registry.path(job_id) / "output" / filename
    if not path.is_file():
        raise HTTPException(404, "Output file not found")
    media_types = {
        ".mp4": "video/mp4", ".srt": "application/x-subrip", ".json": "application/json"
    }
    return FileResponse(path, media_type=media_types.get(path.suffix), filename=filename)


@app.delete("/jobs/{job_id}")
def cancel_job(job_id: str) -> dict[str, Any]:
    return registry.cancel(job_id)
