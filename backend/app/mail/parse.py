"""Turning raw RFC-822 bytes into something the UI can show.

Real mail is messy: headers encoded per RFC 2047, bodies in any charset,
nested multiparts, inline images referenced by Content-ID. This module keeps
all of that in one place so the rest of the app only ever sees plain fields.
"""

from __future__ import annotations

import email
import email.policy
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.message import Message
from email.utils import parsedate_to_datetime, getaddresses


@dataclass
class Attachment:
    filename: str
    content_type: str
    size: int
    # Content-ID without the angle brackets, for images embedded in the HTML.
    content_id: str = ""
    inline: bool = False


@dataclass
class ParsedMessage:
    subject: str = ""
    from_name: str = ""
    from_email: str = ""
    to: list[str] = field(default_factory=list)
    cc: list[str] = field(default_factory=list)
    date: datetime | None = None
    text: str = ""
    html: str = ""
    attachments: list[Attachment] = field(default_factory=list)
    message_id: str = ""


def decode_any(raw: str | None) -> str:
    """Decode an RFC 2047 header ("=?UTF-8?B?...?=") into plain text."""
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw))).strip()
    except (UnicodeDecodeError, LookupError, ValueError):
        return raw.strip()


def _addresses(message: Message, header: str) -> list[str]:
    values = message.get_all(header, [])
    out = []
    for name, addr in getaddresses(values):
        label = decode_any(name)
        out.append(f"{label} <{addr}>" if label else addr)
    return [a for a in out if a]


def _body_text(part: Message) -> str:
    """Decode one leaf part, guessing the charset when it's absent or wrong."""
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        # An unknown charset name; utf-8 with replacement beats failing.
        return payload.decode("utf-8", errors="replace")


def _is_attachment(part: Message) -> bool:
    disposition = (part.get_content_disposition() or "").lower()
    if disposition == "attachment":
        return True
    # Inline parts with a filename still belong in the attachment list.
    return disposition == "inline" and bool(part.get_filename())


def parse_message(raw: bytes) -> ParsedMessage:
    message = email.message_from_bytes(raw, policy=email.policy.compat32)
    parsed = ParsedMessage()

    parsed.subject = decode_any(message.get("Subject"))
    parsed.message_id = (message.get("Message-ID") or "").strip()

    sender = _addresses(message, "From")
    if sender:
        raw_from = sender[0]
        if "<" in raw_from and raw_from.endswith(">"):
            parsed.from_name = raw_from.rsplit("<", 1)[0].strip()
            parsed.from_email = raw_from.rsplit("<", 1)[1][:-1].strip()
        else:
            parsed.from_email = raw_from
    parsed.to = _addresses(message, "To")
    parsed.cc = _addresses(message, "Cc")

    date_header = message.get("Date")
    if date_header:
        try:
            parsed.date = parsedate_to_datetime(date_header)
        except (TypeError, ValueError):
            parsed.date = None
    if parsed.date is not None and parsed.date.tzinfo is not None:
        parsed.date = parsed.date.astimezone(timezone.utc).replace(tzinfo=None)

    for part in message.walk():
        if part.get_content_maintype() == "multipart":
            continue

        if _is_attachment(part):
            payload = part.get_payload(decode=True) or b""
            content_id = (part.get("Content-ID") or "").strip().strip("<>")
            parsed.attachments.append(
                Attachment(
                    filename=decode_any(part.get_filename()) or "adjunto",
                    content_type=part.get_content_type(),
                    size=len(payload),
                    content_id=content_id,
                    inline=(part.get_content_disposition() or "").lower() == "inline",
                )
            )
            continue

        content_type = part.get_content_type()
        if content_type == "text/plain" and not parsed.text:
            parsed.text = _body_text(part)
        elif content_type == "text/html" and not parsed.html:
            parsed.html = _body_text(part)

    return parsed


def part_by_index(raw: bytes, index: int) -> tuple[bytes, str, str]:
    """Re-walk a message to pull out attachment `index`.

    Attachments aren't cached server-side; the message is fetched again and
    walked in the same order parse_message used, so the indexes line up.
    """
    message = email.message_from_bytes(raw, policy=email.policy.compat32)
    found = 0
    for part in message.walk():
        if part.get_content_maintype() == "multipart":
            continue
        if not _is_attachment(part):
            continue
        if found == index:
            payload = part.get_payload(decode=True) or b""
            name = decode_any(part.get_filename()) or "adjunto"
            return payload, part.get_content_type(), name
        found += 1
    raise IndexError("attachment not found")
