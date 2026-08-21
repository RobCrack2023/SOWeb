"""Password hashing and token-based sessions.

Hashing uses PBKDF2 from the standard library rather than bcrypt/argon2 so the
project stays dependency-free; the parameters below are the tunable part.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from .database import get_db
from .models import Session, User

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 480_000
SALT_BYTES = 16

# How stale last_seen may get before a request bothers to rewrite it. Without
# this every single API call would issue a write.
LAST_SEEN_REFRESH = timedelta(seconds=60)
# How recently a session must have been used to count as "connected now".
ONLINE_WINDOW = timedelta(minutes=5)

# auto_error=False so a missing header produces our own 401 rather than a 403.
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return f"{ALGORITHM}${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = stored.split("$")
        if algorithm != ALGORITHM:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    # Constant-time compare so a wrong password can't be narrowed down by timing.
    return secrets.compare_digest(digest.hex(), digest_hex)


def create_session(db: DbSession, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(Session(token=token, user_id=user.id))
    db.commit()
    return token


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: DbSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="No hay sesión iniciada")
    session = db.get(Session, credentials.credentials)
    if session is None:
        raise HTTPException(status_code=401, detail="La sesión expiró o no es válida")

    now = datetime.now(timezone.utc)
    # Stored naive (SQLite), so compare against a naive "now".
    if session.last_seen is None or now.replace(tzinfo=None) - session.last_seen > LAST_SEEN_REFRESH:
        session.last_seen = now.replace(tzinfo=None)
        db.commit()
    return session.user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Necesitás permisos de administrador")
    return user
