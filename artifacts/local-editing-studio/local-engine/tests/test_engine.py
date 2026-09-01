import json
import shutil
import threading
import time

import pytest
from fastapi.testclient import TestClient

import main


def auth_headers():
    return {"X-Local-Engine-Token": main.pairing_token()}


def test_health_is_only_unpaired_endpoint_and_ids_are_validated():
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
        cors = client.get(
            "/health",
            headers={"Origin": "https://artifact.workspace.preview.pike.replit.dev"},
        )
        assert cors.headers["access-control-allow-origin"] == (
            "https://artifact.workspace.preview.pike.replit.dev"
        )
        assert client.get("/assets/no-token").status_code == 401
        assert client.get("/assets/../escape", headers=auth_headers()).status_code == 404
    # HTTP clients normalize dot segments before routing, so validate this
    # boundary directly rather than asserting an unreachable route response.
    with pytest.raises(main.HTTPException) as error:
        main.valid_id("..", "asset id")
    assert error.value.status_code == 400


def test_plan_resolution_accepts_store_shape_and_rejects_bad_ranges():
    timeline = main.resolve_timeline({
        "takes": [{"id": "t1", "assetId": "asset-1", "start": 1, "end": 3}],
        "timeline": [{"takeId": "t1", "order": 2, "text": "Hello"}],
    })
    assert timeline == [{
        "asset_id": "asset-1", "start": 1.0, "end": 3.0, "text": "Hello", "order": 2,
    }]
    with pytest.raises(ValueError, match="invalid time range"):
        main.resolve_timeline({"timeline": [{"asset_id": "asset-1", "start": 4, "end": 3}]})
    with pytest.raises(ValueError, match="invalid asset_id"):
        main.resolve_timeline({"timeline": [{"asset_id": "../x", "start": 1, "end": 3}]})


def test_completed_analysis_result_contract():
    job_id, _ = main.registry.create("analysis", {"asset_ids": ["asset-1"]})
    try:
        output = main.registry.path(job_id) / "output" / "analysis.json"
        output.write_text(json.dumps({"job_id": job_id, "takes": [], "timeline": []}), encoding="utf-8")
        main.registry.write(job_id, status="completed", progress=100, files=["analysis.json"])
        with TestClient(main.app) as client:
            response = client.get(f"/jobs/{job_id}/result", headers=auth_headers())
        assert response.status_code == 200
        assert response.json()["job_id"] == job_id
    finally:
        shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_nvenc_probe_encodes_a_realistic_mp4_frame(monkeypatch):
    class Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(command, **_kwargs):
        assert "color=c=black:s=320x180:r=30" in command
        assert command[command.index("-vf") + 1] == "format=yuv420p"
        assert command[command.index("-c:v") + 1] == "h264_nvenc"
        assert command[command.index("-f") + 1] == "lavfi"
        assert command[-2] == "mp4"
        output = main.Path(command[-1])
        output.write_bytes(b"mp4")
        return Completed()

    monkeypatch.setattr(main.shutil, "which", lambda _name: "ffmpeg")
    monkeypatch.setattr(main.subprocess, "run", fake_run)
    main._nvenc_cache = {"checked_at": 0.0, "usable": False, "error": "Not checked"}

    assert main.nvenc_status()["usable"] is True


def test_run_process_uses_files_not_pipes_and_bounds_returned_output(monkeypatch):
    job_id, _ = main.registry.create("render", {})

    class NoisyProcess:
        returncode = 0

        def __init__(self, _command, **kwargs):
            assert kwargs["stdout"] is not main.subprocess.PIPE
            assert kwargs["stderr"] is not main.subprocess.PIPE
            kwargs["stdout"].write("a" * 1_100_000)
            kwargs["stderr"].write("b" * 1_100_000)
            kwargs["stdout"].flush()
            kwargs["stderr"].flush()

        def poll(self):
            return 0

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr(main.subprocess, "Popen", NoisyProcess)
    try:
        stdout, stderr = main.registry.run_process(job_id, ["fake"])
        assert len(stdout) == 1_000_000
        assert len(stderr) == 1_000_000
    finally:
        shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_run_process_cancellation_terminates_child(monkeypatch):
    job_id, _ = main.registry.create("render", {})
    holder = {}

    class BlockingProcess:
        returncode = None

        def __init__(self, _command, **kwargs):
            holder["process"] = self

        def poll(self):
            return self.returncode

        def terminate(self):
            self.returncode = -15

        def kill(self):
            self.returncode = -9

        def wait(self, timeout=None):
            return self.returncode

    monkeypatch.setattr(main.subprocess, "Popen", BlockingProcess)
    timer = threading.Timer(0.02, lambda: main.registry.cancel(job_id))
    timer.start()
    try:
        with pytest.raises(main.JobCancelled):
            main.registry.run_process(job_id, ["fake"])
        assert holder["process"].returncode == -15
    finally:
        timer.cancel()
        shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_cancelled_child_is_not_reported_as_failed(monkeypatch):
    job_id, _ = main.registry.create("render", {})

    class AlreadyTerminatedProcess:
        returncode = -15

        def __init__(self, _command, **kwargs):
            main.registry.cancel_events[job_id].set()

        def poll(self):
            return self.returncode

        def wait(self, timeout=None):
            return self.returncode

    monkeypatch.setattr(main.subprocess, "Popen", AlreadyTerminatedProcess)
    try:
        with pytest.raises(main.JobCancelled):
            main.registry.run_process(job_id, ["fake"])
    finally:
        shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_storage_protects_running_jobs_and_their_assets():
    asset_id = "protected-test-asset"
    folder = main.asset_dir(asset_id)
    job_id = None
    try:
        folder.mkdir(parents=True)
        (folder / "media").write_bytes(b"video")
        main.atomic_json(folder / "metadata.json", {
            "id": asset_id, "filename": "test.mp4", "complete": True,
            "created_at": main.utcnow(), "updated_at": main.utcnow(),
        })
        with TestClient(main.app) as client:
            job_id, _ = main.registry.create("analysis", {"asset_ids": [asset_id]})
            main.registry.write(job_id, status="running")
            snapshot = client.get("/storage", headers=auth_headers()).json()
            asset = next(item for item in snapshot["assets"] if item["id"] == asset_id)
            assert asset["in_use"] is True
            assert client.delete(f"/assets/{asset_id}", headers=auth_headers()).status_code == 409
            assert client.delete(f"/storage/jobs/{job_id}", headers=auth_headers()).status_code == 409
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        if job_id:
            shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_cleanup_removes_only_safe_old_items():
    old_job = None
    active_job = None
    try:
        with TestClient(main.app) as client:
            old_job, _ = main.registry.create("render", {})
            active_job, _ = main.registry.create("render", {})
            main.registry.write(old_job, status="completed")
            main.registry.write(active_job, status="running")
            old_data = main.registry.read(old_job)
            old_data["updated_at"] = "2020-01-01T00:00:00+00:00"
            main.atomic_json(main.registry.path(old_job) / "job.json", old_data)
            response = client.post("/storage/cleanup", headers=auth_headers(), json={"older_than_days": 1})
        assert response.status_code == 200
        assert old_job in response.json()["deleted_jobs"]
        assert not main.registry.path(old_job).exists()
        assert main.registry.path(active_job).exists()
    finally:
        if old_job:
            shutil.rmtree(main.registry.path(old_job), ignore_errors=True)
        if active_job:
            shutil.rmtree(main.registry.path(active_job), ignore_errors=True)


def test_specific_deletion_and_space_limit_cleanup():
    asset_id = "deletable-test-asset"
    folder = main.asset_dir(asset_id)
    job_id = None
    try:
        folder.mkdir(parents=True)
        (folder / "media").write_bytes(b"x" * 1024)
        main.atomic_json(folder / "metadata.json", {
            "id": asset_id, "filename": "old.mp4", "complete": True,
            "created_at": "2020-01-01T00:00:00+00:00",
            "updated_at": "2020-01-01T00:00:00+00:00",
        })
        with TestClient(main.app) as client:
            job_id, _ = main.registry.create("render", {})
            main.registry.write(job_id, status="completed")
            deleted = client.delete(f"/storage/jobs/{job_id}", headers=auth_headers())
            assert deleted.status_code == 200
            assert not main.registry.path(job_id).exists()

            cleanup = client.post(
                "/storage/cleanup",
                headers=auth_headers(),
                json={"max_bytes": 0},
            )
            assert cleanup.status_code == 200
            assert asset_id in cleanup.json()["deleted_assets"]
            assert cleanup.json()["storage"]["total_bytes"] == 0
    finally:
        shutil.rmtree(folder, ignore_errors=True)
        if job_id:
            shutil.rmtree(main.registry.path(job_id), ignore_errors=True)


def test_asset_delete_waits_for_in_progress_asset_mutation():
    asset_id = "locked-test-asset"
    folder = main.asset_dir(asset_id)
    lock = main.asset_locks[asset_id]
    thread = None
    try:
        folder.mkdir(parents=True)
        (folder / "media").write_bytes(b"partial")
        main.atomic_json(folder / "metadata.json", {
            "id": asset_id, "filename": "uploading.mp4", "complete": False,
            "created_at": main.utcnow(), "updated_at": main.utcnow(),
        })
        lock.acquire()
        thread = threading.Thread(target=main.delete_asset, args=(asset_id,))
        thread.start()
        time.sleep(0.05)
        assert thread.is_alive()
        assert folder.exists()
        lock.release()
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert not folder.exists()
    finally:
        if lock.locked():
            lock.release()
        if thread and thread.is_alive():
            thread.join(timeout=2)
        shutil.rmtree(folder, ignore_errors=True)


def test_cleanup_does_not_claim_files_that_failed_to_delete(monkeypatch):
    asset_id = "undeletable-test-asset"
    folder = main.asset_dir(asset_id)
    original_rmtree = main.shutil.rmtree
    try:
        folder.mkdir(parents=True)
        (folder / "media").write_bytes(b"x" * 1024)
        main.atomic_json(folder / "metadata.json", {
            "id": asset_id, "filename": "locked.mp4", "complete": True,
            "created_at": "2020-01-01T00:00:00+00:00",
            "updated_at": "2020-01-01T00:00:00+00:00",
        })

        def fail_target(path, *args, **kwargs):
            if main.Path(path) == folder:
                raise PermissionError("file is locked")
            return original_rmtree(path, *args, **kwargs)

        monkeypatch.setattr(main.shutil, "rmtree", fail_target)
        with TestClient(main.app) as client:
            response = client.post(
                "/storage/cleanup",
                headers=auth_headers(),
                json={"max_bytes": 0},
            )
        result = response.json()
        assert response.status_code == 200
        assert asset_id not in result["deleted_assets"]
        assert any(item["id"] == asset_id for item in result["failures"])
        assert result["freed_bytes"] == 0
        assert folder.exists()
    finally:
        original_rmtree(folder, ignore_errors=True)