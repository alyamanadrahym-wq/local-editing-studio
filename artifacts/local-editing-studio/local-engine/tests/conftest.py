"""GitHub Actions diagnostics for the real Windows release suite."""

from __future__ import annotations

import os

import pytest


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    outcome = yield
    report = outcome.get_result()
    if (
        os.environ.get("WINDOWS_RELEASE_SMOKE") != "1"
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or report.when != "call"
        or not report.failed
    ):
        return

    message = str(report.longrepr)[-7000:]
    message = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::error title=Windows release smoke failed::{message}", flush=True)