"""waSO — chat between SOWeb accounts.

History and sending go over REST; delivery, typing and presence go over a
WebSocket. Message bodies are never exposed to the admin panel.
"""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from .. import activity
from ..auth import get_current_user
from ..chathub import hub
from ..database import SessionLocal, get_db
from ..models import Conversation, ConversationMember, Message, Session, User
from ..schemas import (
    AddMembers,
    ChatContact,
    ChatConversation,
    ChatMember,
    ChatMessage,
    CreateGroup,
    SendMessage,
)

router = APIRouter(prefix="/api/chat", tags=["chat"])

MESSAGE_KINDS = {"text", "sticker"}
# Sticker ids are catalog keys defined by the frontend. Validating the shape
# rather than an exact list keeps the two sides from having to stay in sync.
STICKER_ID = re.compile(r"^[a-z0-9-]{1,32}$")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _member_or_404(db: DbSession, conversation_id: int, user: User) -> ConversationMember:
    """A conversation the caller doesn't belong to reads as missing."""
    member = (
        db.query(ConversationMember)
        .filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user.id,
        )
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")
    return member


def _members_of(db: DbSession, conversation_id: int) -> list[User]:
    return (
        db.query(User)
        .join(ConversationMember, ConversationMember.user_id == User.id)
        .filter(ConversationMember.conversation_id == conversation_id)
        .order_by(User.username)
        .all()
    )


def _member_ids(db: DbSession, conversation_id: int) -> list[int]:
    rows = (
        db.query(ConversationMember.user_id)
        .filter(ConversationMember.conversation_id == conversation_id)
        .all()
    )
    return [row[0] for row in rows]


def _as_message(message: Message, sender_name: str) -> ChatMessage:
    return ChatMessage(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        sender=sender_name,
        kind=message.kind,
        body=message.body,
        created_at=message.created_at,
    )


def _describe(db: DbSession, conversation: Conversation, viewer: User) -> ChatConversation:
    """Shape a conversation for one viewer: a direct chat is titled after the
    other person, and unread is counted from that viewer's read marker."""
    members = _members_of(db, conversation.id)
    member_out = [
        ChatMember(id=m.id, username=m.username, online=hub.is_online(m.id)) for m in members
    ]

    if conversation.kind == "direct":
        others = [m for m in members if m.id != viewer.id]
        title = others[0].username if others else "Sin destinatario"
    else:
        title = conversation.title or "Grupo"

    marker = (
        db.query(ConversationMember.last_read_at)
        .filter(
            ConversationMember.conversation_id == conversation.id,
            ConversationMember.user_id == viewer.id,
        )
        .scalar()
    )
    unread_query = db.query(func.count(Message.id)).filter(
        Message.conversation_id == conversation.id,
        Message.sender_id != viewer.id,
    )
    if marker is not None:
        unread_query = unread_query.filter(Message.created_at > marker)

    last = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .first()
    )
    names = {m.id: m.username for m in members}

    return ChatConversation(
        id=conversation.id,
        kind=conversation.kind,
        title=title,
        members=member_out,
        unread=unread_query.scalar() or 0,
        last_message=_as_message(last, names.get(last.sender_id, "?")) if last else None,
    )


@router.get("/contacts", response_model=list[ChatContact])
def contacts(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Everyone you can start a conversation with — i.e. every other account."""
    others = db.query(User).filter(User.id != user.id).order_by(User.username).all()
    return [
        ChatContact(id=u.id, username=u.username, online=hub.is_online(u.id)) for u in others
    ]


@router.get("/conversations", response_model=list[ChatConversation])
def list_conversations(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .filter(ConversationMember.user_id == user.id)
        .all()
    )
    described = [_describe(db, c, user) for c in rows]
    # Most recent conversation first; ones with no messages yet sink to the end.
    described.sort(
        key=lambda c: c.last_message.created_at if c.last_message else datetime.min,
        reverse=True,
    )
    return described


@router.post("/direct/{other_id}", response_model=ChatConversation)
def open_direct(
    other_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Find the existing one-to-one chat with someone, or start it."""
    if other_id == user.id:
        raise HTTPException(status_code=400, detail="No podés chatear con vos mismo")
    other = db.get(User, other_id)
    if other is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    mine = (
        db.query(ConversationMember.conversation_id)
        .join(Conversation, Conversation.id == ConversationMember.conversation_id)
        .filter(ConversationMember.user_id == user.id, Conversation.kind == "direct")
        .subquery()
    )
    existing = (
        db.query(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .filter(Conversation.id.in_(mine), ConversationMember.user_id == other_id)
        .first()
    )
    if existing is not None:
        return _describe(db, existing, user)

    conversation = Conversation(kind="direct", created_by=user.id)
    db.add(conversation)
    db.flush()
    db.add_all(
        [
            ConversationMember(conversation_id=conversation.id, user_id=user.id),
            ConversationMember(conversation_id=conversation.id, user_id=other_id),
        ]
    )
    db.commit()
    db.refresh(conversation)
    return _describe(db, conversation, user)


@router.post("/groups", response_model=ChatConversation)
async def create_group(
    payload: CreateGroup,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    members = {user.id, *payload.member_ids}
    found = db.query(User.id).filter(User.id.in_(members)).all()
    if len(found) != len(members):
        raise HTTPException(status_code=400, detail="Algún usuario no existe")

    conversation = Conversation(kind="group", title=payload.title.strip(), created_by=user.id)
    db.add(conversation)
    db.flush()
    db.add_all(
        [ConversationMember(conversation_id=conversation.id, user_id=uid) for uid in members]
    )
    activity.log(db, user.id, "chat.group", payload.title.strip())
    db.commit()
    db.refresh(conversation)

    # Everyone else needs the new group to appear without a manual refresh.
    await hub.send([uid for uid in members if uid != user.id], {"type": "conversation"})
    return _describe(db, conversation, user)


@router.post("/groups/{conversation_id}/members", response_model=ChatConversation)
async def add_members(
    conversation_id: int,
    payload: AddMembers,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _member_or_404(db, conversation_id, user)
    conversation = db.get(Conversation, conversation_id)
    if conversation.kind != "group":
        raise HTTPException(status_code=400, detail="Solo se pueden sumar personas a un grupo")

    existing = set(_member_ids(db, conversation_id))
    to_add = [uid for uid in payload.member_ids if uid not in existing]
    found = {row[0] for row in db.query(User.id).filter(User.id.in_(to_add)).all()}
    if len(found) != len(to_add):
        raise HTTPException(status_code=400, detail="Algún usuario no existe")

    db.add_all(
        [ConversationMember(conversation_id=conversation_id, user_id=uid) for uid in to_add]
    )
    db.commit()
    db.refresh(conversation)

    notify = (existing | set(to_add)) - {user.id}
    await hub.send(list(notify), {"type": "conversation"})
    return _describe(db, conversation, user)


@router.delete("/groups/{conversation_id}/members/me", status_code=204)
async def leave_group(
    conversation_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = _member_or_404(db, conversation_id, user)
    conversation = db.get(Conversation, conversation_id)
    if conversation.kind != "group":
        raise HTTPException(status_code=400, detail="Solo se puede salir de un grupo")

    remaining = [uid for uid in _member_ids(db, conversation_id) if uid != user.id]
    db.delete(member)
    db.commit()
    await hub.send(remaining, {"type": "conversation"})


@router.get("/conversations/{conversation_id}/messages", response_model=list[ChatMessage])
def list_messages(
    conversation_id: int,
    limit: int = 200,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _member_or_404(db, conversation_id, user)
    limit = max(1, min(limit, 500))
    rows = (
        db.query(Message, User.username)
        .join(User, Message.sender_id == User.id)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
        .all()
    )
    # Query is newest-first for the limit; hand them back oldest-first to render.
    return [_as_message(message, name) for message, name in reversed(rows)]


@router.post("/conversations/{conversation_id}/messages", response_model=ChatMessage)
async def send_message(
    conversation_id: int,
    payload: SendMessage,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = _member_or_404(db, conversation_id, user)

    if payload.kind not in MESSAGE_KINDS:
        raise HTTPException(status_code=400, detail="Tipo de mensaje no soportado")
    body = payload.body.strip()
    if payload.kind == "sticker" and not STICKER_ID.match(body):
        raise HTTPException(status_code=400, detail="Sticker inválido")
    if not body:
        raise HTTPException(status_code=400, detail="El mensaje está vacío")

    message = Message(
        conversation_id=conversation_id,
        sender_id=user.id,
        kind=payload.kind,
        body=body,
    )
    db.add(message)
    # Sending implies having read what came before it.
    member.last_read_at = _now()
    # Logged without the text: the admin panel counts messages, never reads them.
    activity.log(db, user.id, "chat.send")
    db.commit()
    db.refresh(message)

    out = _as_message(message, user.username)
    recipients = [uid for uid in _member_ids(db, conversation_id) if uid != user.id]
    await hub.send(recipients, {"type": "message", "message": out.model_dump(mode="json")})
    return out


@router.post("/conversations/{conversation_id}/read", status_code=204)
def mark_read(
    conversation_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = _member_or_404(db, conversation_id, user)
    member.last_read_at = _now()
    db.commit()


@router.websocket("/ws")
async def chat_socket(websocket: WebSocket):
    """Delivery channel.

    The token arrives in the first frame rather than the query string, so a
    session token never lands in a URL or a server access log.
    """
    await websocket.accept()
    user_id: int | None = None

    try:
        opening = await websocket.receive_json()
        token = opening.get("token") if isinstance(opening, dict) else None
        if not token:
            await websocket.close(code=4401)
            return

        with SessionLocal() as db:
            session = db.get(Session, token)
            if session is None:
                await websocket.close(code=4401)
                return
            user_id = session.user_id
            username = session.user.username
            peers = _peer_ids(db, user_id)

        became_online = await hub.connect(user_id, websocket)
        await websocket.send_json({"type": "ready", "user_id": user_id})
        if became_online:
            await hub.send(
                peers, {"type": "presence", "user_id": user_id, "username": username, "online": True}
            )

        while True:
            event = await websocket.receive_json()
            if not isinstance(event, dict):
                continue
            # Typing is ephemeral: relayed to the other members, never stored.
            if event.get("type") == "typing":
                conversation_id = event.get("conversation_id")
                if not isinstance(conversation_id, int):
                    continue
                with SessionLocal() as db:
                    if (
                        db.query(ConversationMember)
                        .filter(
                            ConversationMember.conversation_id == conversation_id,
                            ConversationMember.user_id == user_id,
                        )
                        .first()
                        is None
                    ):
                        continue
                    others = [uid for uid in _member_ids(db, conversation_id) if uid != user_id]
                await hub.send(
                    others,
                    {
                        "type": "typing",
                        "conversation_id": conversation_id,
                        "user_id": user_id,
                        "username": username,
                    },
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        # A malformed frame shouldn't leave the socket registered.
        pass
    finally:
        if user_id is not None:
            went_offline = await hub.disconnect(user_id, websocket)
            if went_offline:
                with SessionLocal() as db:
                    peers = _peer_ids(db, user_id)
                    name = db.get(User, user_id)
                await hub.send(
                    peers,
                    {
                        "type": "presence",
                        "user_id": user_id,
                        "username": name.username if name else "",
                        "online": False,
                    },
                )


def _peer_ids(db: DbSession, user_id: int) -> list[int]:
    """Everyone who shares at least one conversation with this user, so
    presence only reaches people who can actually see them."""
    mine = (
        db.query(ConversationMember.conversation_id)
        .filter(ConversationMember.user_id == user_id)
        .subquery()
    )
    rows = (
        db.query(ConversationMember.user_id)
        .filter(
            ConversationMember.conversation_id.in_(mine),
            ConversationMember.user_id != user_id,
        )
        .distinct()
        .all()
    )
    return [row[0] for row in rows]
