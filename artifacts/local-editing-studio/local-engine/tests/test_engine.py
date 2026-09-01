import json
import shutil
import threading

import pytest
from fastapi.testclient import TestClient

import main


def auth_headers():
    return {"X-Local-Engine-Token": main.pairing_token()}


def test_health_is_only_unpaired_endpoint_and_ids_are_validated():
    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 200
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