"""Real Windows release checks.

These tests intentionally download a Whisper model and invoke FFmpeg. They are
excluded from the normal suite and run only when WINDOWS_RELEASE_SMOKE=1.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest

import main


pytestmark = [
    pytest.mark.windows_release,
    pytest.mark.skipif(
        os.environ.get("WINDOWS_RELEASE_SMOKE") != "1",
        reason="set WINDOWS_RELEASE_SMOKE=1 for the real Windows release suite",
    ),
]

SAMPLE_TEXT = "مرحبا من استوديو المونتاج المحلي. Hello from the local editing studio."
FIXTURE_AUDIO = Path(__file__).parent / "fixtures" / "arabic-english-smoke.mp3"


def _run(command: list[str]) -> None:
    subprocess.run(command, check=True, capture_output=True, text=True)


@pytest.fixture(scope="session")
def bilingual_sample(tmp_path_factory: pytest.TempPathFactory) -> Path:
    supplied = os.environ.get("WINDOWS_RELEASE_SAMPLE")
    if supplied:
        sample = Path(supplied).resolve()
        if not sample.is_file():
            pytest.fail(f"WINDOWS_RELEASE_SAMPLE does not exist: {sample}")
        return sample

    root = tmp_path_factory.mktemp("release-media")
    if not FIXTURE_AUDIO.is_file():
        pytest.fail(f"bundled bilingual fixture is missing: {FIXTURE_AUDIO}")
    sample = root / "bilingual-smoke.mp4"
    _run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=0x172033:s=640x360:r=24",
        "-i", str(FIXTURE_AUDIO), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(sample),
    ])
    return sample


@pytest.fixture
def installed_asset(bilingual_sample: Path):
    asset_id = f"windows-smoke-{time.time_ns()}"
    folder = main.ASSETS / asset_id
    folder.mkdir(parents=True)
    media = folder / "media"
    shutil.copy2(bilingual_sample, media)
    main.atomic_json(folder / "metadata.json", {
        "id": asset_id,
        "filename": bilingual_sample.name,
        "size": media.stat().st_size,
        "received": media.stat().st_size,
        "complete": True,
    })
    yield asset_id
    shutil.rmtree(folder, ignore_errors=True)


def _wait_for_terminal(job_id: str, timeout: float = 300) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = main.registry.read(job_id)
        if job["status"] in {"completed", "failed", "cancelled"}:
            return job
        time.sleep(0.2)
    pytest.fail(f"job {job_id} did not finish within {timeout}s")


def _edit_plan(asset_id: str) -> dict:
    return {"timeline": [{
        "asset_id": asset_id, "start": 0, "end": 1.5,
        "text": SAMPLE_TEXT, "order": 0,
    }]}


def _render(
    installed_asset: str, requested_encoder: str, expected_encoder: str
) -> tuple[str, dict]:
    request = main.RenderRequest(
        plan=_edit_plan(installed_asset),
        width=640, height=360, fps=24, video_bitrate="1M", encoder=requested_encoder,
    )
    job_id, _ = main.registry.create("render", request.model_dump())
    main.run_render(job_id, request)
    job = main.registry.read(job_id)
    assert job.get("encoder") == expected_encoder
    return job_id, job


def _assert_render_contract(
    job_id: str, job: dict, encoder: str, requested_encoder: str, asset_id: str
) -> None:
    assert job["status"] == "completed", job.get("error")
    assert job["encoder"] == encoder
    assert job["files"] == ["video.mp4", "captions.srt", "edit-plan.json"]
    output = main.registry.path(job_id) / "output"
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_type",
        "-of", "json", str(output / "video.mp4"),
    ], check=True, capture_output=True, text=True)
    streams = json.loads(probe.stdout)["streams"]
    assert any(s["codec_type"] == "video" and s["codec_name"] == "h264" for s in streams)
    assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in streams)
    assert SAMPLE_TEXT in (output / "captions.srt").read_text(encoding="utf-8-sig")
    plan = json.loads((output / "edit-plan.json").read_text(encoding="utf-8"))
    assert plan["schema_version"] == 1
    assert plan["encoder"] == encoder
    assert plan["plan"] == _edit_plan(asset_id)
    assert plan["resolved_timeline"] == [{
        "asset_id": asset_id, "start": 0.0, "end": 1.5,
        "text": SAMPLE_TEXT, "order": 0,
    }]
    assert plan["render_settings"] == {
        "width": 640, "height": 360, "fps": 24,
        "video_bitrate": "1M", "encoder": requested_encoder,
    }


def test_cpu_transcription_has_word_timestamps_and_exports_contract(installed_asset: str):
    analysis_id, _ = main.registry.create("analysis", {})
    main.run_analysis(analysis_id, main.AnalysisRequest(
        asset_ids=[installed_asset], model=os.environ.get("WHISPER_MODEL", "tiny"),
        language="auto", device="cpu",
    ))
    analysis = main.registry.read(analysis_id)
    assert analysis["status"] == "completed", analysis.get("error")
    result = json.loads(
        (main.registry.path(analysis_id) / "output" / "analysis.json").read_text("utf-8")
    )
    arabic_words = [
        word for segment in result["segments"] for word in segment["words"]
        if any("\u0600" <= char <= "\u06ff" for char in word["word"])
    ]
    english_words = [
        word for segment in result["segments"] for word in segment["words"]
        if any(char.isascii() and char.isalpha() for char in word["word"])
    ]
    for language_words in (arabic_words, english_words):
        assert language_words
        assert all(word["end"] >= word["start"] >= 0 for word in language_words)
        assert all(
            current["start"] >= previous["start"]
            for previous, current in zip(language_words, language_words[1:])
        )

    render_id, render = _render(installed_asset, "libx264", "libx264")
    _assert_render_contract(render_id, render, "libx264", "libx264", installed_asset)


def test_auto_encoder_falls_back_to_libx264_without_nvenc(installed_asset: str):
    if os.environ.get("EXPECT_RTX") == "1":
        pytest.skip("automatic fallback is qualified by the non-RTX Windows job")
    assert not main.nvenc_status()["usable"], main.nvenc_status()
    render_id, render = _render(installed_asset, "auto", "libx264")
    _assert_render_contract(render_id, render, "libx264", "auto", installed_asset)


def test_rtx_cuda_transcription_and_nvenc_export_when_available(installed_asset: str):
    if os.environ.get("EXPECT_RTX") != "1":
        pytest.skip("RTX smoke runs only on the Windows RTX release runner")
    health = main.hardware_status()
    assert health["rtx_available"], health
    assert any("RTX" in gpu.upper() for gpu in health["nvidia_gpus"]), health
    assert health["cuda_available"], health
    assert main.nvenc_status()["usable"], main.nvenc_status()

    analysis_id, _ = main.registry.create("analysis", {})
    main.run_analysis(analysis_id, main.AnalysisRequest(
        asset_ids=[installed_asset], model=os.environ.get("WHISPER_MODEL", "tiny"),
        language="auto", device="cuda",
    ))
    assert main.registry.read(analysis_id)["status"] == "completed"
    render_id, render = _render(installed_asset, "h264_nvenc", "h264_nvenc")
    _assert_render_contract(
        render_id, render, "h264_nvenc", "h264_nvenc", installed_asset
    )


def test_real_ffmpeg_and_whisper_cancellation(installed_asset: str, monkeypatch):
    render_id, _ = main.registry.create("render", {})
    timer = threading.Timer(0.3, lambda: main.registry.cancel(render_id))
    timer.start()
    try:
        with pytest.raises(main.JobCancelled):
            main.registry.run_process(render_id, [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-f", "lavfi",
                "-i", "testsrc2=s=1920x1080:r=60", "-t", "60", "-f", "null", "-",
            ])
    finally:
        timer.cancel()

    import faster_whisper

    real_model = faster_whisper.WhisperModel
    analysis_id, _ = main.registry.create("analysis", {})

    class CancelAtFirstRealSegment:
        def __init__(self, *args, **kwargs):
            self.model = real_model(*args, **kwargs)

        def transcribe(self, *args, **kwargs):
            segments, info = self.model.transcribe(*args, **kwargs)

            def observed_segments():
                for segment in segments:
                    main.registry.cancel(analysis_id)
                    yield segment

            return observed_segments(), info

    monkeypatch.setattr(faster_whisper, "WhisperModel", CancelAtFirstRealSegment)
    main.run_analysis(analysis_id, main.AnalysisRequest(
        asset_ids=[installed_asset], model="tiny", device="cpu",
    ))
    assert _wait_for_terminal(analysis_id)["status"] == "cancelled"
    assert not (main.registry.path(analysis_id) / "output" / "analysis.json").exists()