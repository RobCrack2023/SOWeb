from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from .. import activity
from ..auth import create_session, get_current_user, hash_password, verify_password
from ..database import get_db
from ..models import Folder, Session, User
from ..schemas import Credentials, LoginOut, PasswordChange, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


def _adopt_legacy_content(db: DbSession, user: User) -> None:
    """Hand the pre-auth filesystem to the first account created.

    Everything used to live in one ownerless desktop. Rather than stranding it,
    whoever registers first inherits it; later accounts start empty.
    """
    orphans = db.query(Folder).filter(Folder.owner_id.is_(None)).all()
    for folder in orphans:
        folder.owner_id = user.id


@router.post("/register", response_model=LoginOut, status_code=201)
def register(payload: Credentials, db: DbSession = Depends(get_db)):
    username = payload.username.strip()
    if db.query(User).filter(User.username == username).first() is not None:
        raise HTTPException(status_code=409, detail="Ese usuario ya existe")

    # The first account runs the place: it inherits the pre-auth files and gets
    # the admin panel. Later accounts are ordinary users.
    is_first_user = db.query(User).count() == 0
    user = User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=is_first_user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if is_first_user:
        _adopt_legacy_content(db, user)
        db.commit()

    activity.log(db, user.id, "user.register", username)
    db.commit()

    # Every account gets its own desktop, so its files are private to it.
    if db.query(Folder).filter(Folder.owner_id == user.id, Folder.is_desktop.is_(True)).first() is None:
        db.add(Folder(name="Escritorio", parent_id=None, owner_id=user.id, is_desktop=True))
        db.commit()

    return LoginOut(token=create_session(db, user), user=UserOut.model_validate(user))


@router.post("/login", response_model=LoginOut)
def login(payload: Credentials, db: DbSession = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    # Same message either way: don't reveal which usernames exist.
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")
    activity.log(db, user.id, "login")
    db.commit()
    return LoginOut(token=create_session(db, user), user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: DbSession = Depends(get_db),
):
    if credentials is not None:
        session = db.get(Session, credentials.credentials)
        if session is not None:
            activity.log(db, session.user_id, "logout")
            db.delete(session)
            db.commit()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/password", status_code=204)
def change_password(
    payload: PasswordChange,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: DbSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change your own password, proving you know the current one."""
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="La contraseña actual no es correcta")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="La contraseña nueva es igual a la actual")

    user.password_hash = hash_password(payload.new_password)
    # A password change should log out everywhere else, in case the old one
    # leaked. The session making the request stays alive.
    keep = credentials.credentials if credentials else None
    for session in db.query(Session).filter(Session.user_id == user.id).all():
        if session.token != keep:
            db.delete(session)
    activity.log(db, user.id, "user.password")
    db.commit()
