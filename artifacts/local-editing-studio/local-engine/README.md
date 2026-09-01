# Local Editing Engine (Windows)

This service keeps original media on the laptop. It binds only to `127.0.0.1`, performs transcription with faster-whisper, and renders with FFmpeg. It does not contain external upload or telemetry code.

## Exact setup and start steps

1. Install 64-bit Python 3.11 or 3.12 from <https://www.python.org/downloads/windows/>. Enable the Python launcher during installation.
2. Open PowerShell in this `local-engine` directory.
3. If Windows blocks local scripts for this terminal, run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   ```
4. Install the pinned Python packages and check/install FFmpeg:
   ```powershell
   .\setup.ps1
   ```
   If FFmpeg was installed by `winget`, close PowerShell, open a new PowerShell in this directory, and run `.\setup.ps1` once more.
5. Start the engine:
   ```powershell
   .\run.ps1
   ```
6. `run.ps1` prints a persistent **pairing token**. Copy it into the browser/app's `X-Local-Engine-Token` request header and keep it private. Confirm `http://127.0.0.1:4317/health` reports `status: "ok"`; health is the only endpoint that does not require the token.

The first analysis with a named Whisper model downloads that model from the model publisher. Media bytes are never sent with that request. To operate fully offline, run the desired model once while online or set `model` to a previously downloaded local model directory name accepted by faster-whisper.

For NVIDIA acceleration, install a current NVIDIA driver and the CUDA/cuDNN runtime versions required by the pinned CTranslate2 package. `/health` reports the detected GPU names, CUDA availability, whether an RTX GPU was found, and `h264_nvenc.usable`. The latter is an actual one-frame FFmpeg NVENC encode test, not just an encoder-list check. `device: "auto"` uses CUDA when CTranslate2 can access it and otherwise uses CPU. Rendering selects `h264_nvenc` only when that test passes; otherwise it uses `libx264`.

Persistent data is under `local-engine\data`. Completed job results survive restarts. A job interrupted by a restart is marked failed and can be submitted again.

## API contract

All request and response bodies are JSON unless noted. IDs must match `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`. Except for `GET /health`, every request must include the token printed by `run.ps1`:

```http
X-Local-Engine-Token: <your-local-pairing-token>
```

The token is generated cryptographically on this computer, persisted at `data\pairing-token.txt`, and is never exposed by HTTP. Stop the engine and delete that file to deliberately rotate it.

### Health

`GET /health` returns FFmpeg/ffprobe versions, faster-whisper installation status, CUDA device count, NVIDIA GPU names, and RTX availability.

### Chunk-safe raw asset ingestion

Initialize:

```http
POST /assets/my-video
Content-Type: application/json

{"filename":"camera-1.mp4","size":123456789,"mime_type":"video/mp4"}
```

Send consecutive raw chunks (maximum 64 MiB each):

```http
PUT /assets/my-video
Content-Type: application/octet-stream
Content-Range: bytes 0-1048575/123456789

<exactly 1048576 raw bytes>
```

The response includes `received` (the next required byte offset) and `complete`. Retry safely by first calling `GET /assets/my-video`; only send from the returned `received` offset. Chunks must be sequential, so concurrent writes cannot corrupt a file. Use `overwrite: true` in the initialize request to intentionally restart an upload. `DELETE /assets/{asset_id}` removes local bytes.

### Analysis jobs

```http
POST /jobs/analysis
Content-Type: application/json

{"asset_ids":["my-video"],"model":"small","language":"auto","device":"auto"}
```

Returns HTTP 202 and a job. `language` is `auto`, `ar`, or `en`; `device` is `auto`, `cuda`, or `cpu`. The result includes per-word timestamps/probabilities, detected language, FFmpeg silence ranges, normalized repeated phrases and their occurrences, ranked take groups with numeric scores and explicit reasons, selected takes, and an ordered timeline.

### Render jobs

Direct timeline form:

```http
POST /jobs/render
Content-Type: application/json

{
  "plan": {
    "timeline": [
      {"asset_id":"my-video","start":2.1,"end":8.4,"text":"Caption text","order":0}
    ]
  },
  "width":1920,
  "height":1080,
  "fps":30,
  "video_bitrate":"12M"
}
```

The React store shape is also accepted: put `takes` in the plan with `id`, `assetId`, `start`, and `end`, then timeline items can reference them with `takeId`. Snake-case equivalents are accepted. The engine validates all media ranges, transcodes real video/audio clips, and concatenates them into a standards-compatible H.264/AAC MP4. Timeline `text` or `caption` values become SRT cues; if none exist the SRT is intentionally empty.

### Poll, results, downloads, and cancellation

* `GET /jobs/{job_id}` — status is `queued`, `running`, `cancelling`, `cancelled`, `failed`, or `completed`; also returns progress 0–100, message, explicit failure error, and selected `encoder` for renders.
* `GET /jobs/{job_id}/result` — analysis JSON, or render file URLs plus selected `encoder` after completion.
* `GET /jobs/{job_id}/files/{filename}` — local download for declared job outputs only.
* `DELETE /jobs/{job_id}` — requests cancellation. Active FFmpeg/ffprobe processes are terminated; Whisper iteration stops at its next segment boundary.

Render output is saved in `data\jobs\<job_id>\output` as `video.mp4`, `captions.srt`, and reopenable `edit-plan.json`. Analysis output is `analysis.json`.

## CORS and privacy

CORS permits loopback development origins and Replit development/preview origins only, and permits the `X-Local-Engine-Token` header for authenticated browser calls. CORS is not the security boundary: all non-health API routes verify the pairing token with constant-time comparison. The server also listens on loopback, so another computer cannot connect. Asset and output paths are generated by the engine; client IDs and filenames are validated to prevent traversal. No endpoint accepts an arbitrary filesystem path.

## Tests

After `setup.ps1`, run:

```powershell
.\.venv\Scripts\python.exe -m py_compile main.py
.\.venv\Scripts\python.exe -m pytest -q
```

The test suite uses mocks for FFmpeg subprocess behavior and does not download or run a Whisper model.