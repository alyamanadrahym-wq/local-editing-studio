"""Frozen and source entry point for the Local Editing Engine."""

from __future__ import annotations

import os
import sys
from pathlib import Path


def bundled_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def configure_bundled_tools() -> None:
    tools = bundled_dir() / "tools"
    if tools.is_dir():
        os.environ["PATH"] = str(tools) + os.pathsep + os.environ.get("PATH", "")


def main() -> None:
    configure_bundled_tools()
    import uvicorn
    from main import pairing_token

    print()
    print("Local Editing Engine is starting at http://127.0.0.1:4317")
    print("Pairing code (keep it private):")
    print(pairing_token(), flush=True)
    print()
    uvicorn.run("main:app", host="127.0.0.1", port=4317, log_level="info")


if __name__ == "__main__":
    main()