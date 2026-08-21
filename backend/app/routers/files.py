import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import activity
from ..auth import get_current_user
from ..database import get_db
from ..models import Folder, FileEntry, User
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
)

router = APIRouter(prefix="/api", tags=["files"])

STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage"


def _breadcrumb(db: Session, folder: Folder | None) -> list[Folder]:
    chain: list[Folder] = []
    current = folder
    while current is not None:
        chain.append(current)
        current = current.parent
    return list(reversed(chain))


def _get_folder_or_404(db: Session, folder_id: int, user: User) -> Folder:
    """Someone else's folder reads as missing rather than forbidden, so the API
    never confirms that an id belongs to another account."""
    folder = db.get(Folder, folder_id)
    if folder is None or folder.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def _get_file_or_404(db: Session, file_id: int, user: User) -> FileEntry:
    """Files have no owner column of their own — they inherit it from the
    folder they live in."""
    entry = db.get(FileEntry, file_id)
    if entry is None or entry.folder is None or entry.folder.owner_id != user.id:
        raise HTTPException(status_code=404, detail="File not found")
    return entry


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
        .filter(Folder.parent_id == folder_id, Folder.owner_id == user.id)
        .order_by(Folder.name)
        .all()
    )
    files = db.query(FileEntry).filter(FileEntry.folder_id == folder_id).order_by(FileEntry.name).all() if folder_id is not None else []

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
    for file in folder.files:
        blob = STORAGE_DIR / file.storage_path
        blob.unlink(missing_ok=True)
    activity.log(db, user.id, "folder.delete", folder.name)
    db.delete(folder)
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
    blob = STORAGE_DIR / entry.storage_path
    blob.unlink(missing_ok=True)
    activity.log(db, user.id, "file.delete", entry.name)
    db.delete(entry)
    db.commit()
