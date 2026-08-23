import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import activity
from ..auth import get_current_user
from ..database import get_db
from ..models import Folder, FileEntry, User
from .chat import notify_direct
from ..schemas import (
    FolderCreate,
    FolderRename,
    FolderOut,
    FileOut,
    FileRename,
    FileCreate,
    FileContentOut,
    FileContentUpdate,
    FolderContents,
    SearchHit,
    ShareFile,
    TrashItem,
)

router = APIRouter(prefix="/api", tags=["files"])

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _breadcrumb(db: Session, folder: Folder | None) -> list[Folder]:
    chain: list[Folder] = []
    current = folder
    while current is not None:
        chain.append(current)
        current = current.parent
    return list(reversed(chain))


def _get_folder_or_404(
    db: Session, folder_id: int, user: User, *, trashed: bool = False
) -> Folder:
    """Someone else's folder reads as missing rather than forbidden, so the API
    never confirms that an id belongs to another account. Trashed folders are
    invisible too, except to the trash endpoints that pass trashed=True."""
    folder = db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Folder not found")
    if (folder.deleted_at is not None) != trashed:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _get_file_or_404(
    db: Session, file_id: int, user: User, *, trashed: bool = False
) -> FileEntry:
    """Files have no owner column of their own — they inherit it from the
    folder they live in."""
    entry = db.get(FileEntry, file_id)
    if entry is None or entry.folder is None or entry.folder.owner_id != user.id:
        raise HTTPException(status_code=404, detail="File not found")
    if (entry.deleted_at is not None) != trashed:
        raise HTTPException(status_code=404, detail="File not found")
    return entry


def _descendant_folders(db: Session, folder: Folder) -> list[Folder]:
    """Every folder below `folder`, itself included, breadth-first."""
    found = [folder]
    frontier = [folder.id]
    while frontier:
        children = db.query(Folder).filter(Folder.parent_id.in_(frontier)).all()
        if not children:
            break
        found.extend(children)
        frontier = [c.id for c in children]
    return found


def _creates_cycle(db: Session, folder_id: int, new_parent_id: int) -> bool:
    """True if setting `folder_id`'s parent to `new_parent_id` would make
    `folder_id` an ancestor of itself (i.e. new_parent_id is folder_id or one
    of its current descendants)."""
    current: Folder | None = db.get(Folder, new_parent_id)
    while current is not None:
        if current.id == folder_id:
            return True
        current = current.parent
    return False


def get_or_create_desktop(db: Session, user: User) -> Folder:
    desktop = (
        db.query(Folder)
        .filter(Folder.owner_id == user.id, Folder.is_desktop.is_(True))
        .first()
    )
    if desktop is None:
        desktop = Folder(name="Escritorio", parent_id=None, owner_id=user.id, is_desktop=True)
        db.add(desktop)
        db.commit()
        db.refresh(desktop)
    return desktop


@router.get("/folders/desktop-id")
def get_desktop_id(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"id": get_or_create_desktop(db, user).id}


@router.get("/folders/contents", response_model=FolderContents)
def get_contents(
    folder_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = None
    if folder_id is not None:
        folder = _get_folder_or_404(db, folder_id, user)

    subfolders = (
        db.query(Folder)
        .filter(
            Folder.parent_id == folder_id,
            Folder.owner_id == user.id,
            Folder.deleted_at.is_(None),
        )
        .order_by(Folder.name)
        .all()
    )
    files = (
        db.query(FileEntry)
        .filter(FileEntry.folder_id == folder_id, FileEntry.deleted_at.is_(None))
        .order_by(FileEntry.name)
        .all()
        if folder_id is not None
        else []
    )

    return FolderContents(
        folder=folder,
        breadcrumb=_breadcrumb(db, folder),
        folders=subfolders,
        files=files,
    )


@router.post("/folders", response_model=FolderOut)
def create_folder(
    payload: FolderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if payload.parent_id is not None:
        _get_folder_or_404(db, payload.parent_id, user)

    folder = Folder(name=payload.name, parent_id=payload.parent_id, owner_id=user.id)
    db.add(folder)
    activity.log(db, user.id, "folder.create", payload.name)
    db.commit()
    db.refresh(folder)
    return folder


@router.patch("/folders/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: int,
    payload: FolderRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = _get_folder_or_404(db, folder_id, user)
    if payload.name is not None:
        folder.name = payload.name
    # parent_id may be explicitly set to null (move to root), so check whether
    # the field was sent at all rather than whether it's non-None.
    if "parent_id" in payload.model_fields_set:
        new_parent_id = payload.parent_id
        if new_parent_id == folder_id:
            raise HTTPException(status_code=400, detail="Una carpeta no puede ser su propio padre")
        if new_parent_id is not None:
            _get_folder_or_404(db, new_parent_id, user)
            if _creates_cycle(db, folder_id, new_parent_id):
                raise HTTPException(
                    status_code=400,
                    detail="No se puede mover una carpeta dentro de sí misma o de una subcarpeta suya",
                )
        folder.parent_id = new_parent_id
    if "pos_x" in payload.model_fields_set:
        folder.pos_x = payload.pos_x
    if "pos_y" in payload.model_fields_set:
        folder.pos_y = payload.pos_y
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = _get_folder_or_404(db, folder_id, user)
    if folder.is_desktop:
        raise HTTPException(status_code=400, detail="No se puede eliminar el Escritorio")

    # Moving to the trash, not erasing: the whole subtree is marked with one
    # timestamp so restoring the folder brings its contents back with it.
    when = _now()
    for descendant in _descendant_folders(db, folder):
        if descendant.deleted_at is None:
            descendant.deleted_at = when
        for file in descendant.files:
            if file.deleted_at is None:
                file.deleted_at = when
    activity.log(db, user.id, "folder.delete", folder.name)
    db.commit()


@router.post("/files", response_model=FileOut)
def create_text_file(
    payload: FileCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_folder_or_404(db, payload.folder_id, user)

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{payload.name}"
    dest = STORAGE_DIR / stored_name
    data = payload.content.encode("utf-8")
    dest.write_bytes(data)

    entry = FileEntry(
        name=payload.name,
        folder_id=payload.folder_id,
        size=len(data),
        content_type=payload.content_type,
        storage_path=stored_name,
    )
    db.add(entry)
    activity.log(db, user.id, "file.create", payload.name)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/files/{file_id}/content", response_model=FileContentOut)
def get_file_content(
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user)
    blob = STORAGE_DIR / entry.storage_path
    # Binary files (uploaded Office documents) are fetched via /download instead;
    # never fail here just because the bytes aren't valid UTF-8.
    text = blob.read_text(encoding="utf-8", errors="replace") if blob.exists() else ""
    return FileContentOut(
        id=entry.id,
        name=entry.name,
        folder_id=entry.folder_id,
        content_type=entry.content_type,
        content=text,
    )


@router.put("/files/{file_id}/content", response_model=FileOut)
def update_file_content(
    file_id: int,
    payload: FileContentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user)
    blob = STORAGE_DIR / entry.storage_path
    data = payload.content.encode("utf-8")
    blob.write_bytes(data)
    entry.size = len(data)
    activity.log(db, user.id, "file.save", entry.name)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/files/upload", response_model=FileOut)
async def upload_file(
    folder_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_folder_or_404(db, folder_id, user)

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{file.filename}"
    dest = STORAGE_DIR / stored_name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    size = dest.stat().st_size
    entry = FileEntry(
        name=file.filename,
        folder_id=folder_id,
        size=size,
        content_type=file.content_type,
        storage_path=stored_name,
    )
    db.add(entry)
    activity.log(db, user.id, "file.upload", file.filename)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/files/{file_id}/download")
def download_file(
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user)
    blob = STORAGE_DIR / entry.storage_path
    if not blob.exists():
        raise HTTPException(status_code=404, detail="File blob missing")
    return FileResponse(blob, filename=entry.name, media_type=entry.content_type or "application/octet-stream")


@router.patch("/files/{file_id}", response_model=FileOut)
def update_file(
    file_id: int,
    payload: FileRename,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user)
    if payload.name is not None:
        # This endpoint also receives every icon drag, so only a real rename
        # is worth an activity entry.
        if payload.name != entry.name:
            activity.log(db, user.id, "file.rename", f"{entry.name} → {payload.name}")
        entry.name = payload.name
    if payload.folder_id is not None:
        _get_folder_or_404(db, payload.folder_id, user)
        entry.folder_id = payload.folder_id
    if "pos_x" in payload.model_fields_set:
        entry.pos_x = payload.pos_x
    if "pos_y" in payload.model_fields_set:
        entry.pos_y = payload.pos_y
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/files/{file_id}", status_code=204)
def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user)
    # Soft delete: the bytes stay on disk until the trash is emptied.
    entry.deleted_at = _now()
    activity.log(db, user.id, "file.delete", entry.name)
    db.commit()


# --- Papelera --------------------------------------------------------------


def _path_of(db: Session, folder: Folder | None) -> str:
    """Readable location ("Escritorio / Informes") for trash and search rows."""
    if folder is None:
        return "Mi unidad"
    names = [f.name for f in _breadcrumb(db, folder)]
    return " / ".join(names) if names else folder.name


def _purge_folder(db: Session, folder: Folder) -> None:
    """Erase a folder subtree for real, removing every stored blob first."""
    for descendant in _descendant_folders(db, folder):
        for file in descendant.files:
            (STORAGE_DIR / file.storage_path).unlink(missing_ok=True)
    # The relationships cascade, so deleting the root removes the rows below it.
    db.delete(folder)


@router.get("/trash", response_model=list[TrashItem])
def list_trash(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Only the top of each deleted subtree is listed: trashing a folder marks
    its contents too, and showing all of them would be noise."""
    trashed_ids = {
        row[0]
        for row in db.query(Folder.id).filter(
            Folder.owner_id == user.id, Folder.deleted_at.isnot(None)
        )
    }

    items: list[TrashItem] = []
    folders = (
        db.query(Folder)
        .filter(Folder.owner_id == user.id, Folder.deleted_at.isnot(None))
        .all()
    )
    for folder in folders:
        if folder.parent_id in trashed_ids:
            continue
        items.append(
            TrashItem(
                kind="folder",
                id=folder.id,
                name=folder.name,
                size=None,
                content_type=None,
                location=_path_of(db, folder.parent),
                deleted_at=folder.deleted_at,
            )
        )

    files = (
        db.query(FileEntry)
        .join(Folder, FileEntry.folder_id == Folder.id)
        .filter(Folder.owner_id == user.id, FileEntry.deleted_at.isnot(None))
        .all()
    )
    for file in files:
        if file.folder_id in trashed_ids:
            continue
        items.append(
            TrashItem(
                kind="file",
                id=file.id,
                name=file.name,
                size=file.size,
                content_type=file.content_type,
                location=_path_of(db, file.folder),
                deleted_at=file.deleted_at,
            )
        )

    items.sort(key=lambda i: i.deleted_at, reverse=True)
    return items


@router.post("/trash/folders/{folder_id}/restore", status_code=204)
def restore_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = _get_folder_or_404(db, folder_id, user, trashed=True)
    # If the parent is still in the trash the folder would come back invisible,
    # so it returns to the desktop instead.
    if folder.parent_id is not None:
        parent = db.get(Folder, folder.parent_id)
        if parent is None or parent.deleted_at is not None:
            desktop = get_or_create_desktop(db, user)
            folder.parent_id = desktop.id

    for descendant in _descendant_folders(db, folder):
        descendant.deleted_at = None
        for file in descendant.files:
            file.deleted_at = None
    db.commit()


@router.post("/trash/files/{file_id}/restore", status_code=204)
def restore_file(
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user, trashed=True)
    if entry.folder is None or entry.folder.deleted_at is not None:
        entry.folder_id = get_or_create_desktop(db, user).id
    entry.deleted_at = None
    db.commit()


@router.delete("/trash/folders/{folder_id}", status_code=204)
def purge_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    folder = _get_folder_or_404(db, folder_id, user, trashed=True)
    _purge_folder(db, folder)
    db.commit()


@router.delete("/trash/files/{file_id}", status_code=204)
def purge_file(
    file_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = _get_file_or_404(db, file_id, user, trashed=True)
    (STORAGE_DIR / entry.storage_path).unlink(missing_ok=True)
    db.delete(entry)
    db.commit()


@router.delete("/trash", status_code=204)
def empty_trash(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    trashed_ids = {
        row[0]
        for row in db.query(Folder.id).filter(
            Folder.owner_id == user.id, Folder.deleted_at.isnot(None)
        )
    }

    # Loose files first, then whole folder subtrees.
    loose = (
        db.query(FileEntry)
        .join(Folder, FileEntry.folder_id == Folder.id)
        .filter(Folder.owner_id == user.id, FileEntry.deleted_at.isnot(None))
        .all()
    )
    for file in loose:
        if file.folder_id in trashed_ids:
            continue
        (STORAGE_DIR / file.storage_path).unlink(missing_ok=True)
        db.delete(file)

    roots = (
        db.query(Folder)
        .filter(Folder.owner_id == user.id, Folder.deleted_at.isnot(None))
        .all()
    )
    for folder in roots:
        if folder.parent_id in trashed_ids:
            continue
        _purge_folder(db, folder)

    activity.log(db, user.id, "trash.empty")
    db.commit()


# --- Búsqueda --------------------------------------------------------------


@router.get("/search", response_model=list[SearchHit])
def search(
    q: str = Query(min_length=1, max_length=120),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Find files and folders by name, anywhere in this user's drive."""
    # Escape the LIKE wildcards so a literal % or _ searches for itself.
    needle = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    if not needle:
        return []
    pattern = f"%{needle}%"

    hits: list[SearchHit] = []
    folders = (
        db.query(Folder)
        .filter(
            Folder.owner_id == user.id,
            Folder.deleted_at.is_(None),
            Folder.name.ilike(pattern, escape="\\"),
        )
        .order_by(Folder.name)
        .limit(50)
        .all()
    )
    for folder in folders:
        hits.append(
            SearchHit(
                kind="folder",
                id=folder.id,
                name=folder.name,
                folder_id=folder.parent_id,
                location=_path_of(db, folder.parent),
                size=None,
                content_type=None,
            )
        )

    files = (
        db.query(FileEntry)
        .join(Folder, FileEntry.folder_id == Folder.id)
        .filter(
            Folder.owner_id == user.id,
            FileEntry.deleted_at.is_(None),
            FileEntry.name.ilike(pattern, escape="\\"),
        )
        .order_by(FileEntry.name)
        .limit(100)
        .all()
    )
    for file in files:
        hits.append(
            SearchHit(
                kind="file",
                id=file.id,
                name=file.name,
                folder_id=file.folder_id,
                location=_path_of(db, file.folder),
                size=file.size,
                content_type=file.content_type,
            )
        )
    return hits


# --- Compartir entre cuentas ----------------------------------------------


RECEIVED_FOLDER = "Recibidos"


@router.get("/users", response_model=list[dict])
def list_share_targets(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Accounts a file can be sent to — everyone but yourself."""
    rows = db.query(User).filter(User.id != user.id).order_by(User.username).all()
    return [{"id": u.id, "username": u.username} for u in rows]


@router.post("/files/{file_id}/share", response_model=FileOut)
async def share_file(
    file_id: int,
    payload: ShareFile,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send a copy to another account.

    A copy rather than shared access: accounts are otherwise fully isolated,
    and granting cross-account read would mean permission checks on every
    path that touches a file. The recipient owns what they receive.
    """
    entry = _get_file_or_404(db, file_id, user)
    if payload.to_user_id == user.id:
        raise HTTPException(status_code=400, detail="Ese archivo ya es tuyo")

    target = db.get(User, payload.to_user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    source = STORAGE_DIR / entry.storage_path
    if not source.exists():
        raise HTTPException(status_code=404, detail="El archivo ya no está en el servidor")

    # Everything received lands in one folder on the recipient's desktop.
    desktop = get_or_create_desktop(db, target)
    inbox = (
        db.query(Folder)
        .filter(
            Folder.owner_id == target.id,
            Folder.parent_id == desktop.id,
            Folder.name == RECEIVED_FOLDER,
            Folder.deleted_at.is_(None),
        )
        .first()
    )
    if inbox is None:
        inbox = Folder(name=RECEIVED_FOLDER, parent_id=desktop.id, owner_id=target.id)
        db.add(inbox)
        db.flush()

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}_{entry.name}"
    shutil.copyfile(source, STORAGE_DIR / stored_name)

    copy = FileEntry(
        name=entry.name,
        folder_id=inbox.id,
        size=entry.size,
        content_type=entry.content_type,
        storage_path=stored_name,
    )
    db.add(copy)
    # Logged without the recipient: the panel counts shares, it doesn't map
    # who talks to whom.
    activity.log(db, user.id, "file.share", entry.name)
    db.commit()
    db.refresh(copy)

    # Tell them through waSO, which they already watch. A failure here must
    # not undo a share that already happened.
    note = payload.note.strip()
    text = f"📎 Te compartí «{entry.name}» — está en tu carpeta {RECEIVED_FOLDER}."
    if note:
        text += f"\n{note}"
    try:
        await notify_direct(db, user, target.id, text)
    except Exception:
        pass

    return copy
