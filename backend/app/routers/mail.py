"""mailSO — an email client for accounts the user already has.

Every route is a plain `def`: the IMAP/POP3/SMTP libraries block, so FastAPI
runs these in its threadpool rather than stalling the event loop (which the
chat WebSocket shares).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session as DbSession

from .. import activity
from ..auth import get_current_user
from ..crypto import decrypt, encrypt
from ..database import get_db
from ..mail import client as mailclient
from ..mail.parse import part_by_index
from ..mail.send import send_message
from ..models import MailAccount, User
from ..schemas import (
    MailAccountIn,
    MailAccountOut,
    MailAttachment,
    MailEnvelope,
    MailListOut,
    MailMessageOut,
    SendMailIn,
)

router = APIRouter(prefix="/api/mail", tags=["mail"])

PROTOCOLS = {"imap", "pop3"}


def _account_or_404(db: DbSession, account_id: int, user: User) -> MailAccount:
    """Someone else's account reads as missing, never as forbidden."""
    account = db.get(MailAccount, account_id)
    if account is None or account.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")
    return account


def _credentials(account: MailAccount) -> mailclient.Credentials:
    password = decrypt(account.password_enc)
    if not password:
        raise HTTPException(
            status_code=409,
            detail="No se pudo descifrar la contraseña guardada. Editá la cuenta y volvé a ingresarla.",
        )
    return mailclient.Credentials(
        protocol=account.protocol,
        host=account.host,
        port=account.port,
        use_ssl=account.use_ssl,
        username=account.username,
        password=password,
    )


def _guard(action):
    """Run a mail operation, turning protocol failures into readable 502s."""
    try:
        return action()
    except mailclient.MailError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/accounts", response_model=list[MailAccountOut])
def list_accounts(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return (
        db.query(MailAccount)
        .filter(MailAccount.owner_id == user.id)
        .order_by(MailAccount.id)
        .all()
    )


@router.post("/accounts", response_model=MailAccountOut, status_code=201)
def create_account(
    payload: MailAccountIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.protocol not in PROTOCOLS:
        raise HTTPException(status_code=400, detail="Protocolo no soportado")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Falta la contraseña")

    account = MailAccount(
        owner_id=user.id,
        label=payload.label.strip(),
        email=payload.email.strip(),
        protocol=payload.protocol,
        host=payload.host.strip(),
        port=payload.port,
        use_ssl=payload.use_ssl,
        username=payload.username.strip(),
        password_enc=encrypt(payload.password),
        smtp_host=payload.smtp_host.strip(),
        smtp_port=payload.smtp_port,
        smtp_ssl=payload.smtp_ssl,
        smtp_username=payload.smtp_username.strip(),
        smtp_password_enc=encrypt(payload.smtp_password) if payload.smtp_password else "",
    )
    db.add(account)
    # Logged by label only — an address is personal and the panel never needs it.
    activity.log(db, user.id, "mail.account", payload.label.strip())
    db.commit()
    db.refresh(account)
    return account


@router.put("/accounts/{account_id}", response_model=MailAccountOut)
def update_account(
    account_id: int,
    payload: MailAccountIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    if payload.protocol not in PROTOCOLS:
        raise HTTPException(status_code=400, detail="Protocolo no soportado")

    account.label = payload.label.strip()
    account.email = payload.email.strip()
    account.protocol = payload.protocol
    account.host = payload.host.strip()
    account.port = payload.port
    account.use_ssl = payload.use_ssl
    account.username = payload.username.strip()
    account.smtp_host = payload.smtp_host.strip()
    account.smtp_port = payload.smtp_port
    account.smtp_ssl = payload.smtp_ssl
    account.smtp_username = payload.smtp_username.strip()
    # An empty password field means "leave the stored one alone".
    if payload.password:
        account.password_enc = encrypt(payload.password)
    if payload.smtp_password:
        account.smtp_password_enc = encrypt(payload.smtp_password)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(
    account_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    db.delete(account)
    db.commit()


@router.post("/accounts/test", status_code=204)
def test_settings(
    payload: MailAccountIn,
    user: User = Depends(get_current_user),
):
    """Try the settings before saving them, so a typo is caught up front."""
    if payload.protocol not in PROTOCOLS:
        raise HTTPException(status_code=400, detail="Protocolo no soportado")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Falta la contraseña")
    creds = mailclient.Credentials(
        protocol=payload.protocol,
        host=payload.host.strip(),
        port=payload.port,
        use_ssl=payload.use_ssl,
        username=payload.username.strip(),
        password=payload.password,
    )
    _guard(lambda: mailclient.check(creds))


@router.get("/accounts/{account_id}/folders", response_model=list[str])
def folders(
    account_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    return _guard(lambda: mailclient.list_folders(_credentials(account)))


@router.get("/accounts/{account_id}/messages", response_model=MailListOut)
def messages(
    account_id: int,
    folder: str = "INBOX",
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    envelopes, total = _guard(
        lambda: mailclient.list_messages(_credentials(account), folder, limit, offset)
    )
    return MailListOut(
        messages=[MailEnvelope(**vars(e)) for e in envelopes],
        total=total,
    )


@router.get("/accounts/{account_id}/messages/{uid}", response_model=MailMessageOut)
def message(
    account_id: int,
    uid: str,
    folder: str = "INBOX",
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    creds = _credentials(account)
    raw = _guard(lambda: mailclient.fetch_raw(creds, folder, uid))
    parsed = mailclient.parse_full(raw)
    # Opening a message marks it read, the way any mail client does.
    _guard(lambda: mailclient.mark_seen(creds, folder, uid, True))

    return MailMessageOut(
        uid=uid,
        subject=parsed.subject,
        from_name=parsed.from_name,
        from_email=parsed.from_email,
        to=parsed.to,
        cc=parsed.cc,
        date=parsed.date,
        text=parsed.text,
        html=parsed.html,
        message_id=parsed.message_id,
        attachments=[
            MailAttachment(
                index=i,
                filename=a.filename,
                content_type=a.content_type,
                size=a.size,
                inline=a.inline,
            )
            for i, a in enumerate(parsed.attachments)
        ],
    )


@router.get("/accounts/{account_id}/messages/{uid}/attachments/{index}")
def attachment(
    account_id: int,
    uid: str,
    index: int,
    folder: str = "INBOX",
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    raw = _guard(lambda: mailclient.fetch_raw(_credentials(account), folder, uid))
    try:
        payload, content_type, filename = part_by_index(raw, index)
    except IndexError:
        raise HTTPException(status_code=404, detail="Adjunto no encontrado")
    return Response(
        content=payload,
        media_type=content_type,
        # attachment, never inline: the browser must not render foreign HTML
        # or SVG from an email on this origin.
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/accounts/{account_id}/messages/{uid}/seen", status_code=204)
def set_seen(
    account_id: int,
    uid: str,
    seen: bool = True,
    folder: str = "INBOX",
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    _guard(lambda: mailclient.mark_seen(_credentials(account), folder, uid, seen))


@router.delete("/accounts/{account_id}/messages/{uid}", status_code=204)
def delete_message(
    account_id: int,
    uid: str,
    folder: str = "INBOX",
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    _guard(lambda: mailclient.delete_message(_credentials(account), folder, uid))


@router.post("/accounts/{account_id}/send", status_code=204)
def send(
    account_id: int,
    payload: SendMailIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    account = _account_or_404(db, account_id, user)
    # Most providers reuse the mailbox credentials for SMTP.
    smtp_user = account.smtp_username or account.username
    smtp_pass = decrypt(account.smtp_password_enc) if account.smtp_password_enc else decrypt(account.password_enc)

    _guard(
        lambda: send_message(
            host=account.smtp_host,
            port=account.smtp_port,
            use_ssl=account.smtp_ssl,
            username=smtp_user,
            password=smtp_pass,
            sender=account.email,
            to=[a.strip() for a in payload.to if a.strip()],
            cc=[a.strip() for a in payload.cc if a.strip()],
            subject=payload.subject,
            body=payload.body,
            in_reply_to=payload.in_reply_to,
        )
    )
    activity.log(db, user.id, "mail.send")
    db.commit()
