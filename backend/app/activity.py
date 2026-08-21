"""Recording what users do, for the admin panel's usage view.

Only metadata is ever stored — a file's name, an app's title — never the
contents of anything a user wrote.
"""

from sqlalchemy.orm import Session as DbSession

from .models import Activity

# Actions the client is allowed to report. Anything else is rejected, so a
# tampered-with browser can't invent arbitrary entries in the log.
CLIENT_ACTIONS = {"app.open"}

MAX_DETAIL = 255


def log(db: DbSession, user_id: int, action: str, detail: str | None = None) -> None:
    """Append an entry. Commits are left to the caller's own transaction."""
    db.add(
        Activity(
            user_id=user_id,
            action=action,
            detail=detail[:MAX_DETAIL] if detail else None,
        )
    )
