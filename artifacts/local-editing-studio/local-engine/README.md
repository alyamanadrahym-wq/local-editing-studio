# Local Editing Engine (Windows)

This service keeps original media on the laptop. It binds only to `127.0.0.1`, performs transcription with faster-whisper, and renders with FFmpeg. It does not contain external upload or telemetry code.

## التثبيت على Windows بنقرة واحدة

1. نزّل `LocalEditingEngine-Setup-<version>.exe` وشغّله. لا تحتاج إلى تثبيت Python أو FFmpeg أو تعديل `PATH`؛ كلاهما موجود داخل الحزمة.
2. اترك خيار اختصار سطح المكتب محددًا، ثم اضغط **Install**.
3. شغّل اختصار **تشغيل محرك المونتاج**. تظهر نافذة الحالة عندما يصبح المحرك جاهزًا، وتعرض رمز الاقتران وتنسخه إلى الحافظة.
4. يمكنك لاحقًا استخدام اختصاري **حالة محرك المونتاج ورمز الاقتران** و**إيقاف محرك المونتاج** من قائمة ابدأ.

المحرك يستمع محليًا فقط على `http://127.0.0.1:4317`. رمز الاقتران خاص بهذا الكمبيوتر ويجب عدم مشاركته. مسار `/health` وحده لا يحتاج إلى الرمز.

## التحديثات الآمنة

شغّل مُثبّت الإصدار الجديد فوق الإصدار الحالي. يستبدل المُثبّت ملفات البرنامج والاعتماديات فقط. المشاريع والوسائط ونتائج الرندر ورمز الاقتران محفوظة بصورة مستقلة تحت:

```text
%LOCALAPPDATA%\LocalEditingStudio\EngineData
```

لذلك لا يحذفها التحديث ولا يعيد رمز الاقتران. كما ينقل المُثبّت تلقائيًا بيانات الإصدارات القديمة من مجلد البرنامج إلى هذا الموقع عند أول ترقية.

## إزالة التثبيت بالكامل

1. افتح **Settings → Apps → Installed apps**.
2. اختر **Local Editing Engine** ثم **Uninstall**. يتوقف المحرك وتُحذف ملفات البرنامج والاختصارات.
3. حفاظًا على مشاريعك، لا يحذف برنامج الإزالة بياناتك تلقائيًا. إذا أردت إزالة كل المشاريع والوسائط والنتائج ورمز الاقتران نهائيًا، احذف هذا المجلد يدويًا بعد الإزالة:
   ```text
   %LOCALAPPDATA%\LocalEditingStudio
   ```

هذا الحذف النهائي غير قابل للتراجع.

## إنشاء حزمة إصدار (للمطور)

يتطلب جهاز البناء Windows x64 وPython 3.11/3.12 و[Inno Setup 6](https://jrsoftware.org/isinfo.php). من PowerShell:

```powershell
.\windows\build-installer.ps1 -Version 1.0.0 -FfmpegSha256 <SHA-256>
```

أو استخدم `.\setup.ps1 -Version 1.0.0 -FfmpegSha256 <SHA-256>` للاختصار. يجب أخذ البصمة من ملف الإصدار الموثوق ومراجعتها عند ترقية FFmpeg؛ يرفض البناء أي تنزيل لا يطابقها. ينشئ البناء بيئة مؤقتة، يثبت الاعتماديات المثبتة الإصدارات، وينزّل إصدار FFmpeg محددًا، ويجمّد المحرك مع Python عبر PyInstaller، ثم ينتج ملفًا واحدًا في `dist`. يجب بناء الحزمة على Windows؛ لا يمكن إنتاج ملف Windows موثوق من Linux.

للتطوير من المصدر، أنشئ `.venv` وثبّت `requirements.txt` ثم شغّل `.\run.ps1`. يعتمد تشغيل المصدر على FFmpeg في `PATH`، بينما الحزمة النهائية لا تعتمد عليه.

The first analysis with a named Whisper model downloads that model from the model publisher. Media bytes are never sent with that request. To operate fully offline, run the desired model once while online or set `model` to a previously downloaded local model directory name accepted by faster-whisper.

For NVIDIA acceleration, install a current NVIDIA driver and the CUDA/cuDNN runtime versions required by the pinned CTranslate2 package. `/health` reports the detected GPU names, CUDA availability, whether an RTX GPU was found, and `h264_nvenc.usable`. The latter is an actual one-frame FFmpeg NVENC encode test, not just an encoder-list check. `device: "auto"` uses CUDA when CTranslate2 can access it and otherwise uses CPU. Rendering selects `h264_nvenc` only when that test passes; otherwise it uses `libx264`.

Persistent installed data is under `%LOCALAPPDATA%\LocalEditingStudio\EngineData`; source development defaults to `local-engine\data`. Set `LOCAL_EDITING_ENGINE_DATA` to override either location. Completed job results survive restarts. A job interrupted by a restart is marked failed and can be submitted again.

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
  "video_bitrate":"12M",
  "encoder":"auto"
}
```

The React store shape is also accepted: put `takes` in the plan with `id`, `assetId`, `start`, and `end`, then timeline items can reference them with `takeId`. Snake-case equivalents are accepted. `encoder` is `auto` (NVENC when its real probe passes, otherwise libx264), `libx264`, or `h264_nvenc`; explicitly requesting unavailable NVENC fails instead of silently claiming GPU output. The engine validates all media ranges, transcodes real video/audio clips, and concatenates them into a standards-compatible H.264/AAC MP4. Timeline `text` or `caption` values become SRT cues; if none exist the SRT is intentionally empty.

### Poll, results, downloads, and cancellation

* `GET /jobs/{job_id}` — status is `queued`, `running`, `cancelling`, `cancelled`, `failed`, or `completed`; also returns progress 0–100, message, explicit failure error, and selected `encoder` for renders.
* `GET /jobs/{job_id}/result` — analysis JSON, or render file URLs plus selected `encoder` after completion.
* `GET /jobs/{job_id}/files/{filename}` — local download for declared job outputs only.
* `DELETE /jobs/{job_id}` — requests cancellation. Active FFmpeg/ffprobe processes are terminated; Whisper iteration stops at its next segment boundary.

Render output is saved in `data\jobs\<job_id>\output` as `video.mp4`, `captions.srt`, and reopenable `edit-plan.json`. Analysis output is `analysis.json`.

## CORS and privacy

CORS permits loopback development origins and Replit development/preview origins only, and permits the `X-Local-Engine-Token` header for authenticated browser calls. CORS is not the security boundary: all non-health API routes verify the pairing token with constant-time comparison. The server also listens on loopback, so another computer cannot connect. Asset and output paths are generated by the engine; client IDs and filenames are validated to prevent traversal. No endpoint accepts an arbitrary filesystem path.

## Tests

From a development virtual environment, run:

```powershell
.\.venv\Scripts\python.exe -m py_compile main.py
.\.venv\Scripts\python.exe -m pytest -q
```

Normal tests remain fast and use mocks. Weekly, and through the mandatory release workflow, `.github/workflows/windows-engine-release-smoke.yml` runs the `windows_release` suite on real Windows CPU and RTX runners. It downloads the tiny Whisper model, turns the bundled short Arabic/English speech fixture into a test video, verifies both languages and word timestamps, exports and probes MP4/AAC plus Arabic/English SRT and reopenable JSON, and cancels real FFmpeg and Whisper work.

To qualify a particular camera/container combination too, set `WINDOWS_RELEASE_SAMPLE` to another short Arabic/English video before running the suite. Otherwise the checked-in deterministic bilingual fixture is used.

```powershell
$env:WINDOWS_RELEASE_SMOKE = "1"
$env:WINDOWS_RELEASE_SAMPLE = "C:\release-fixtures\arabic-english.mp4" # recommended
.\.venv\Scripts\python.exe -m pytest -q -m windows_release
```

A self-hosted runner labeled `Windows`, `X64`, and `RTX` is required for CUDA transcription and a real `h264_nvenc` export. Install a current NVIDIA RTX GPU and driver plus the CUDA/cuDNN runtime required by CTranslate2. The workflow provisions Python, installs the engine dependencies, installs FFmpeg through Chocolatey when needed, and verifies `ffmpeg`, `ffprobe`, `nvidia-smi`, the reported RTX model, CUDA, and a real NVENC encode before testing. It never silently passes through the CPU fallback. The CPU job explicitly verifies `libx264` and verifies that `auto` falls back to it when the NVENC probe fails.

To create a release, run **Windows engine release smoke** manually and enter the desired `release_tag`. The workflow creates that tag and GitHub Release only after both the hosted CPU job and required self-hosted RTX job pass. Do not create release tags through another path. Leave `release_tag` blank for a qualification-only run. This makes Windows qualification a pre-release gate rather than a check that starts after a tag already exists.
