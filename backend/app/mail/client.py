"""Talking to the mail server.

The browser can't open a TCP socket, so the backend is the actual mail client:
it connects out to IMAP or POP3 and hands the frontend plain JSON. Everything
here is blocking, which is why the routes that call it are plain `def` — FastAPI
runs those in a threadpool instead of stalling the event loop.
"""

from __future__ import annotations

import imaplib
import poplib
import re
import socket
from contextlib import contextmanager
from dataclasses import dataclass

from .parse import ParsedMessage, parse_message

# Servers can be slow; without a cap a bad host would hang the request forever.
TIMEOUT = 25
# POP3 has no server-side search, so the whole listing is pulled. Keep it sane.
POP3_MAX = 100
# imaplib's default (10 KB) is too small for real message lists.
imaplib._MAXLINE = 10_000_000


class MailError(Exception):
    """Anything the user should see as a readable message rather than a 500."""


@dataclass
class Credentials:
    protocol: str
    host: str
    port: int
    use_ssl: bool
    username: str
    password: str


@dataclass
class Envelope:
    """One row in the message list — headers only, never the body."""

    uid: str
    subject: str
    from_name: str
    from_email: str
    date: str | None
    seen: bool
    has_attachments: bool


@contextmanager
def _imap(creds: Credentials):
    try:
        factory = imaplib.IMAP4_SSL if creds.use_ssl else imaplib.IMAP4
        connection = factory(creds.host, creds.port, timeout=TIMEOUT)
    except (OSError, socket.timeout) as exc:
        raise MailError(f"No se pudo conectar a {creds.host}:{creds.port} ({exc})") from exc

    try:
        try:
            connection.login(creds.username, creds.password)
        except imaplib.IMAP4.error as exc:
            raise MailError(_login_hint(str(exc), creds.host)) from exc
        yield connection
    finally:
        try:
            connection.logout()
        except Exception:
            pass


def _login_hint(message: str, host: str) -> str:
    """Turn a bare "AUTHENTICATIONFAILED" into something actionable."""
    text = message.strip().strip("b'\"")
    if "gmail" in host.lower():
        return (
            "Gmail rechazó las credenciales. Gmail ya no acepta la contraseña "
            "normal: hay que generar una «contraseña de aplicación» (con la "
            "verificación en 2 pasos activada) y tener IMAP habilitado. "
            f"Respuesta del servidor: {text}"
        )
    return f"El servidor rechazó usuario o contraseña: {text}"


@contextmanager
def _pop3(creds: Credentials):
    try:
        factory = poplib.POP3_SSL if creds.use_ssl else poplib.POP3
        connection = factory(creds.host, creds.port, timeout=TIMEOUT)
    except (OSError, socket.timeout) as exc:
        raise MailError(f"No se pudo conectar a {creds.host}:{creds.port} ({exc})") from exc

    try:
        try:
            connection.user(creds.username)
            connection.pass_(creds.password)
        except poplib.error_proto as exc:
            raise MailError(_login_hint(str(exc), creds.host)) from exc
        yield connection
    finally:
        try:
            connection.quit()
        except Exception:
            pass


def check(creds: Credentials) -> None:
    """Connect and authenticate, nothing more — used by "Probar conexión"."""
    if creds.protocol == "pop3":
        with _pop3(creds):
            return
    with _imap(creds):
        return


# --- IMAP ------------------------------------------------------------------

_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) "(?P<delim>[^"]*)" (?P<name>.*)')


def _folder_name(raw: bytes) -> tuple[str, bool]:
    """Parse one LIST response line into (name, selectable)."""
    match = _LIST_RE.match(raw)
    if not match:
        return raw.decode("utf-8", "replace"), True
    flags = match.group("flags").decode("ascii", "replace").lower()
    name = match.group("name").decode("utf-8", "replace").strip().strip('"')
    return name, "\\noselect" not in flags


def list_folders(creds: Credentials) -> list[str]:
    if creds.protocol == "pop3":
        # POP3 has no concept of folders at all.
        return ["INBOX"]
    with _imap(creds) as connection:
        status, data = connection.list()
        if status != "OK":
            raise MailError("No se pudieron listar las carpetas")
        folders = []
        for line in data:
            if not isinstance(line, bytes):
                continue
            name, selectable = _folder_name(line)
            if name and selectable:
                folders.append(name)
        # INBOX first; the rest alphabetically.
        folders.sort(key=lambda f: (f.upper() != "INBOX", f.lower()))
        return folders


def _decode_envelope(uid: bytes, header_blob: bytes, flags: bytes) -> Envelope:
    parsed = parse_message(header_blob)
    flag_text = flags.decode("ascii", "replace").lower()
    return Envelope(
        uid=uid.decode("ascii", "replace"),
        subject=parsed.subject,
        from_name=parsed.from_name,
        from_email=parsed.from_email,
        date=parsed.date.isoformat() if parsed.date else None,
        seen="\\seen" in flag_text,
        # The header alone can't prove it, but a multipart/mixed almost always
        # means something is attached.
        has_attachments="multipart/mixed" in header_blob.decode("utf-8", "replace").lower(),
    )


def list_messages(creds: Credentials, folder: str, limit: int, offset: int) -> tuple[list[Envelope], int]:
    if creds.protocol == "pop3":
        return _pop3_list(creds, limit, offset)

    with _imap(creds) as connection:
        try:
            status, _ = connection.select(f'"{folder}"', readonly=True)
        except imaplib.IMAP4.error as exc:
            raise MailError(f"No se pudo abrir la carpeta {folder}: {exc}") from exc
        if status != "OK":
            raise MailError(f"No se pudo abrir la carpeta {folder}")

        status, data = connection.uid("search", None, "ALL")
        if status != "OK":
            raise MailError("La búsqueda de mensajes falló")
        uids = data[0].split() if data and data[0] else []
        total = len(uids)
        if not uids:
            return [], 0

        # Newest first, then take the page the client asked for.
        page = list(reversed(uids))[offset : offset + limit]
        if not page:
            return [], total

        wanted = b",".join(page)
        status, response = connection.uid(
            "fetch", wanted, "(FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE CONTENT-TYPE)])"
        )
        if status != "OK":
            raise MailError("No se pudieron leer los encabezados")

        by_uid: dict[bytes, Envelope] = {}
        for item in response:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            meta, header_blob = item[0], item[1]
            uid_match = re.search(rb"UID (\d+)", meta)
            if not uid_match:
                continue
            flags_match = re.search(rb"FLAGS \(([^)]*)\)", meta)
            envelope = _decode_envelope(
                uid_match.group(1), header_blob, flags_match.group(1) if flags_match else b""
            )
            by_uid[uid_match.group(1)] = envelope

        # Preserve the newest-first order the page was built in.
        ordered = [by_uid[uid] for uid in page if uid in by_uid]
        return ordered, total


def fetch_raw(creds: Credentials, folder: str, uid: str) -> bytes:
    if creds.protocol == "pop3":
        return _pop3_fetch(creds, uid)

    with _imap(creds) as connection:
        status, _ = connection.select(f'"{folder}"', readonly=False)
        if status != "OK":
            raise MailError(f"No se pudo abrir la carpeta {folder}")
        status, data = connection.uid("fetch", uid.encode(), "(RFC822)")
        if status != "OK" or not data or not isinstance(data[0], tuple):
            raise MailError("No se pudo descargar el mensaje")
        return data[0][1]


def mark_seen(creds: Credentials, folder: str, uid: str, seen: bool) -> None:
    if creds.protocol == "pop3":
        # POP3 has no server-side flags; nothing to do.
        return
    with _imap(creds) as connection:
        status, _ = connection.select(f'"{folder}"', readonly=False)
        if status != "OK":
            raise MailError(f"No se pudo abrir la carpeta {folder}")
        command = "+FLAGS" if seen else "-FLAGS"
        connection.uid("store", uid.encode(), command, "(\\Seen)")


def delete_message(creds: Credentials, folder: str, uid: str) -> None:
    if creds.protocol == "pop3":
        with _pop3(creds) as connection:
            connection.dele(int(uid))
        return
    with _imap(creds) as connection:
        status, _ = connection.select(f'"{folder}"', readonly=False)
        if status != "OK":
            raise MailError(f"No se pudo abrir la carpeta {folder}")
        connection.uid("store", uid.encode(), "+FLAGS", "(\\Deleted)")
        connection.expunge()


# --- POP3 ------------------------------------------------------------------


def _pop3_list(creds: Credentials, limit: int, offset: int) -> tuple[list[Envelope], int]:
    with _pop3(creds) as connection:
        count = len(connection.list()[1])
        total = min(count, POP3_MAX)
        if total == 0:
            return [], 0

        # POP3 numbers messages 1..n oldest-first; show newest first.
        numbers = list(range(count, max(0, count - POP3_MAX), -1))
        page = numbers[offset : offset + limit]

        envelopes = []
        for number in page:
            # TOP gives the headers without pulling the whole body down.
            _, lines, _ = connection.top(number, 0)
            blob = b"\r\n".join(lines)
            parsed = parse_message(blob)
            envelopes.append(
                Envelope(
                    uid=str(number),
                    subject=parsed.subject,
                    from_name=parsed.from_name,
                    from_email=parsed.from_email,
                    date=parsed.date.isoformat() if parsed.date else None,
                    seen=True,
                    has_attachments="multipart/mixed" in blob.decode("utf-8", "replace").lower(),
                )
            )
        return envelopes, total


def _pop3_fetch(creds: Credentials, uid: str) -> bytes:
    with _pop3(creds) as connection:
        _, lines, _ = connection.retr(int(uid))
        return b"\r\n".join(lines)


def parse_full(raw: bytes) -> ParsedMessage:
    return parse_message(raw)
