"""
Entry point for the Smart Parking Management System.
Run from project root: python3 run.py
"""
import sys
import os

# Ensure project root is on sys.path so `backend` package resolves
# even when uvicorn spawns reload subprocesses.
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import uvicorn


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

if __name__ == "__main__":
    reload_enabled = _env_flag("UVICORN_RELOAD", default=False)
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=reload_enabled,
        reload_dirs=[project_root] if reload_enabled else None,
    )
