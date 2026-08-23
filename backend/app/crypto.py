"""Encryption for stored mail credentials.

A mail password is worth far more than anything else in the database, so it is
never written in the clear. Fernet (AES-128-CBC + HMAC) is used with a key that
lives outside the database — so a stolen `soweb.db` alone reveals nothing.

The key is read from SOWEB_SECRET_KEY when set; otherwise one is generated and
kept in `backend/.secret_key`, which is git-ignored. Losing the key means the
stored passwords can't be read back and the accounts have to be set up again;
it does not lose any mail, which lives on the provider's server.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

KEY_ENV = "SOWEB_SECRET_KEY"
KEY_PATH = Path(__file__).resolve().parent.parent / ".secret_key"

_fernet: Fernet | None = None


def _load_key() -> bytes:
    from_env = os.environ.get(KEY_ENV)
    if from_env:
        return from_env.encode("utf-8")

    if KEY_PATH.exists():
        return KEY_PATH.read_bytes().strip()

    key = Fernet.generate_key()
    KEY_PATH.write_bytes(key)
    try:
        # Best effort on POSIX; Windows ignores the mode.
        KEY_PATH.chmod(0o600)
    except OSError:
        pass
    return key


def _cipher() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(_load_key())
    return _fernet


def encrypt(value: str) -> str:
    return _cipher().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Returns "" when the stored value can't be read — usually a rotated key.
    Callers surface that as "re-enter your password" rather than crashing."""
    try:
        return _cipher().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""
