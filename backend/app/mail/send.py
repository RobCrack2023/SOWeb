"""Sending through the account's SMTP server."""

from __future__ import annotations

import smtplib
import socket
from email.message import EmailMessage

from .client import MailError

TIMEOUT = 25


def send_message(
    *,
    host: str,
    port: int,
    use_ssl: bool,
    username: str,
    password: str,
    sender: str,
    to: list[str],
    cc: list[str],
    subject: str,
    body: str,
    in_reply_to: str = "",
) -> None:
    if not host:
        raise MailError("Esta cuenta no tiene servidor de salida (SMTP) configurado")
    if not to and not cc:
        raise MailError("Falta el destinatario")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = subject
    if in_reply_to:
        # Lets the recipient's client thread the reply with the original.
        message["In-Reply-To"] = in_reply_to
        message["References"] = in_reply_to
    message.set_content(body)

    try:
        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT)
        else:
            server = smtplib.SMTP(host, port, timeout=TIMEOUT)
    except (OSError, socket.timeout) as exc:
        raise MailError(f"No se pudo conectar a {host}:{port} ({exc})") from exc

    try:
        if not use_ssl:
            try:
                # Port 587 expects STARTTLS; a server without it still works.
                server.starttls()
            except smtplib.SMTPNotSupportedError:
                pass
        if username:
            try:
                server.login(username, password)
            except smtplib.SMTPAuthenticationError as exc:
                raise MailError(
                    "El servidor de salida rechazó usuario o contraseña. "
                    "En Gmail hay que usar una contraseña de aplicación."
                ) from exc
        server.send_message(message, from_addr=sender, to_addrs=[*to, *cc])
    except smtplib.SMTPException as exc:
        raise MailError(f"No se pudo enviar: {exc}") from exc
    finally:
        try:
            server.quit()
        except Exception:
            pass
