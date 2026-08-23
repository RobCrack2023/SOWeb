"""Sticky notes and the calendar — small per-user accessories."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DbSession

from ..auth import get_current_user
from ..database import get_db
from ..models import CalendarEvent, Note, User
from ..schemas import EventIn, EventOut, NoteIn, NoteOut

router = APIRouter(prefix="/api", tags=["desk"])

NOTE_COLORS = {"amarillo", "rosa", "celeste", "verde", "lila"}
MAX_NOTES = 60


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# --- Notas ------------------------------------------------------------------


@router.get("/notes", response_model=list[NoteOut])
def list_notes(db: DbSession = Depends(get_db), user: User = Depends(get_current_user)):
    return db.query(Note).filter(Note.owner_id == user.id).order_by(Note.id).all()


@router.post("/notes", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if db.query(Note).filter(Note.owner_id == user.id).count() >= MAX_NOTES:
        raise HTTPException(status_code=400, detail="Demasiadas notas en el escritorio")
    note = Note(
        owner_id=user.id,
        body=payload.body,
        color=payload.color if payload.color in NOTE_COLORS else "amarillo",
        pos_x=payload.pos_x,
        pos_y=payload.pos_y,
        width=payload.width,
        height=payload.height,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.put("/notes/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = db.get(Note, note_id)
    if note is None or note.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    note.body = payload.body
    if payload.color in NOTE_COLORS:
        note.color = payload.color
    note.pos_x = payload.pos_x
    note.pos_y = payload.pos_y
    note.width = payload.width
    note.height = payload.height
    db.commit()
    db.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = db.get(Note, note_id)
    if note is None or note.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Nota no encontrada")
    db.delete(note)
    db.commit()


# --- Calendario -------------------------------------------------------------


@router.get("/events", response_model=list[EventOut])
def list_events(
    since: datetime | None = None,
    until: datetime | None = None,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = db.query(CalendarEvent).filter(CalendarEvent.owner_id == user.id)
    if since is not None:
        query = query.filter(CalendarEvent.starts_at >= since)
    if until is not None:
        query = query.filter(CalendarEvent.starts_at < until)
    return query.order_by(CalendarEvent.starts_at).all()


@router.get("/events/due", response_model=list[EventOut])
def due_events(
    within_minutes: int = Query(default=60, ge=1, le=1440),
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Events whose reminder window has opened but that haven't started yet —
    what the desktop polls to raise a notice."""
    now = _now()
    horizon = now + timedelta(minutes=within_minutes)
    rows = (
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.owner_id == user.id,
            CalendarEvent.remind_minutes.isnot(None),
            CalendarEvent.starts_at >= now,
            CalendarEvent.starts_at <= horizon,
        )
        .order_by(CalendarEvent.starts_at)
        .all()
    )
    return [
        event
        for event in rows
        if event.starts_at - timedelta(minutes=event.remind_minutes or 0) <= now
    ]


@router.post("/events", response_model=EventOut, status_code=201)
def create_event(
    payload: EventIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    event = CalendarEvent(
        owner_id=user.id,
        title=payload.title.strip(),
        notes=payload.notes,
        starts_at=_naive(payload.starts_at),
        all_day=payload.all_day,
        remind_minutes=payload.remind_minutes,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/events/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventIn,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if event is None or event.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    event.title = payload.title.strip()
    event.notes = payload.notes
    event.starts_at = _naive(payload.starts_at)
    event.all_day = payload.all_day
    event.remind_minutes = payload.remind_minutes
    db.commit()
    db.refresh(event)
    return event


@router.delete("/events/{event_id}", status_code=204)
def delete_event(
    event_id: int,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    event = db.get(CalendarEvent, event_id)
    if event is None or event.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Evento no encontrado")
    db.delete(event)
    db.commit()


def _naive(value: datetime) -> datetime:
    """Everything is stored as naive UTC; an offset-aware input is converted."""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)
