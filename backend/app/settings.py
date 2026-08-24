"""Everything that differs between a laptop and a real server.

Each value falls back to the development default, so `uvicorn app.main:app`
still works with nothing configured.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _path(env: str, default: Path) -> Path:
    raw = os.environ.get(env, "").strip()
    return Path(raw).expanduser() if raw else default


def _list(env: str, default: list[str]) -> list[str]:
    raw = os.environ.get(env, "").strip()
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


# Data that has to outlive a deploy. Point these at a directory the release
# process never replaces.
DB_PATH = _path("SOWEB_DB_PATH", BASE_DIR / "soweb.db")
STORAGE_DIR = _path("SOWEB_STORAGE_DIR", BASE_DIR / "storage")

# Browser origins allowed to call the API. Empty when the frontend is served
# from the same origin (the nginx setup), which needs no CORS at all.
CORS_ORIGINS = _list("SOWEB_CORS_ORIGINS", ["http://localhost:5173"])

# When set, registering requires this code. Keeps a private instance private.
INVITE_CODE = os.environ.get("SOWEB_INVITE_CODE", "").strip()

# Failed logins allowed per username before it's refused for a while.
LOGIN_MAX_ATTEMPTS = int(os.environ.get("SOWEB_LOGIN_MAX_ATTEMPTS", "8"))
LOGIN_LOCKOUT_SECONDS = int(os.environ.get("SOWEB_LOGIN_LOCKOUT_SECONDS", "300"))
