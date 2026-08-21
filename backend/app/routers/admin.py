"""Read-only supervision endpoints for admin accounts.

Deliberately exposes metadata only: who is connected, what they created, how
much space it takes. There is no endpoint here that returns file contents —
reading another account's documents still isn't possible.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session as DbSession

from ..auth import ONLINE_WINDOW, get_admin_user
from ..database import get_db
from ..models import Activity, FileEntry, Folder, Session, User
from ..schemas import (
    AdminActivity,
    AdminFile,
    AdminOverview,
    AdminSession,
    AdminUser,
)

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(get_admin_user)])


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _is_online(last_seen: datetime | None) -> bool:
    return last_seen is not None and _now() - last_seen <= ONLINE_WINDOW


def _latest_seen_by_user(db: DbSession) -> dict[int, datetime]:
    rows = (
        db.query(Session.user_id, func.max(Session.last_seen))
        .group_by(Session.user_id)
        .all()
    )
    return {user_id: last_seen for user_id, last_seen in rows if last_seen is not None}


@router.get("/overview", response_model=AdminOverview)
def overview(db: DbSession = Depends(get_db)):
    since = _now() - timedelta(days=1)
    latest = _latest_seen_by_user(db)
    return AdminOverview(
        users=db.query(func.count(User.id)).scalar() or 0,
        online=sum(1 for seen in latest.values() if _is_online(seen)),
        folders=db.query(func.count(Folder.id)).scalar() or 0,
        files=db.query(func.count(FileEntry.id)).scalar() or 0,
        storage_bytes=db.query(func.coalesce(func.sum(FileEntry.size), 0)).scalar() or 0,
        actions_today=db.query(func.count(Activity.id))
        .filter(Activity.created_at >= since)
        .scalar()
        or 0,
    )


@router.get("/users", response_model=list[AdminUser])
def list_users(db: DbSession = Depends(get_db)):
    latest = _latest_seen_by_user(db)

    # Per-user totals in one pass each, rather than a query per user.
    folder_counts = dict(
        db.query(Folder.owner_id, func.count(Folder.id)).group_by(Folder.owner_id).all()
    )
    file_rows = (
        db.query(
            Folder.owner_id,
            func.count(FileEntry.id),
            func.coalesce(func.sum(FileEntry.size), 0),
        )
        .join(Folder, FileEntry.folder_id == Folder.id)
        .group_by(Folder.owner_id)
        .all()
    )
    file_stats = {owner: (count, size) for owner, count, size in file_rows}

    result = []
    for user in db.query(User).order_by(User.username).all():
        files, storage = file_stats.get(user.id, (0, 0))
        last_seen = latest.get(user.id)
        result.append(
            AdminUser(
                id=user.id,
                username=user.username,
                is_admin=user.is_admin,
                created_at=user.created_at,
                online=_is_online(last_seen),
                last_seen=last_seen,
                files=files,
                folders=folder_counts.get(user.id, 0),
                storage_bytes=storage,
            )
        )
    return result


@router.get("/sessions", response_model=list[AdminSession])
def list_sessions(db: DbSession = Depends(get_db)):
    """Open sessions, most recently active first. A session disappears from
    here when its owner logs out, since logout deletes the token."""
    rows = (
        db.query(Session, User)
        .join(User, Session.user_id == User.id)
        .order_by(Session.last_seen.desc())
        .all()
    )
    return [
        AdminSession(
            user_id=session.user_id,
            username=user.username,
            started_at=session.created_at,
            last_seen=session.last_seen,
            online=_is_online(session.last_seen),
        )
        for session, user in rows
    ]


@router.get("/activity", response_model=list[AdminActivity])
def list_activity(
    limit: int = Query(100, ge=1, le=500),
    user_id: int | None = None,
    db: DbSession = Depends(get_db),
):
    query = db.query(Activity, User).join(User, Activity.user_id == User.id)
    if user_id is not None:
        query = query.filter(Activity.user_id == user_id)
    rows = query.order_by(Activity.created_at.desc(), Activity.id.desc()).limit(limit).all()
    return [
        AdminActivity(
            id=entry.id,
            user_id=entry.user_id,
            username=user.username,
            action=entry.action,
            detail=entry.detail,
            created_at=entry.created_at,
        )
        for entry, user in rows
    ]


@router.get("/users/{user_id}/files", response_model=list[AdminFile])
def list_user_files(user_id: int, db: DbSession = Depends(get_db)):
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    rows = (
        db.query(FileEntry, Folder)
        .join(Folder, FileEntry.folder_id == Folder.id)
        .filter(Folder.owner_id == user_id)
        .order_by(FileEntry.created_at.desc())
        .all()
    )
    return [
        AdminFile(
            id=entry.id,
            name=entry.name,
            folder=folder.name,
            size=entry.size,
            content_type=entry.content_type,
            created_at=entry.created_at,
        )
        for entry, folder in rows
    ]
