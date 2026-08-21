from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from .. import activity
from ..auth import get_current_user
from ..database import get_db
from ..models import User
from ..schemas import ActivityReport

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.post("", status_code=204)
def report(
    payload: ActivityReport,
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Let the browser report things the server can't see for itself, like
    which app was opened. Restricted to a known set of actions so the log
    can't be filled with arbitrary entries."""
    if payload.action not in activity.CLIENT_ACTIONS:
        raise HTTPException(status_code=400, detail="Acción no permitida")
    activity.log(db, user.id, payload.action, payload.detail)
    db.commit()
