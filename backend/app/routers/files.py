import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Folder, FileEntry
from ..schemas import (
    FolderCreate,
    FolderRename,
    FolderOut,
    FileOut,
    FileRename,
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


def _get_folder_or_404(db: Session, folder_id: int) -> Folder:
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


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


def get_or_create_desktop(db: Session) -> Folder:
    desktop = db.query(Folder).filter(Folder.is_desktop.is_(True)).first()
    if desktop is None:
        desktop = Folder(name="Escritorio", parent_id=None, is_desktop=True)
        db.add(desktop)
        db.commit()
        db.refresh(desktop)
    return desktop


@router.get("/folders/desktop-id")
def get_desktop_id(db: Session = Depends(get_db)):
    return {"id": get_or_create_desktop(db).id}


@router.get("/folders/contents", response_model=FolderContents)
def get_contents(folder_id: int | None = None, db: Session = Depends(get_db)):
    folder = None
    if folder_id is not None:
        folder = _get_folder_or_404(db, folder_id)

    subfolders = db.query(Folder).filter(Folder.parent_id == folder_id).order_by(Folder.name).all()
    files = db.query(FileEntry).filter(FileEntry.folder_id == folder_id).order_by(FileEntry.name).all() if folder_id is not None else []

    return FolderContents(
        folder=folder,
        breadcrumb=_breadcrumb(db, folder),
        folders=subfolders,
        files=files,
    )


@router.post("/folders", response_model=FolderOut)
def create_folder(payload: FolderCreate, db: Session = Depends(get_db)):
    if payload.parent_id is not None:
        _get_folder_or_404(db, payload.parent_id)

    folder = Folder(name=payload.name, parent_id=payload.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.patch("/folders/{folder_id}", response_model=FolderOut)
def update_folder(folder_id: int, payload: FolderRename, db: Session = Depends(get_db)):
    folder = _get_folder_or_404(db, folder_id)
    if payload.name is not None:
        folder.name = payload.name
    # parent_id may be explicitly set to null (move to root), so check whether
    # the field was sent at all rather than whether it's non-None.
    if "parent_id" in payload.model_fields_set:
        new_parent_id = payload.parent_id
        if new_parent_id == folder_id:
            raise HTTPException(status_code=400, detail="Una carpeta no puede ser su propio padre")
        if new_parent_id is not None:
            _get_folder_or_404(db, new_parent_id)
            if _creates_cycle(db, folder_id, new_parent_id):
                raise HTTPException(
                    status_code=400,
                    detail="No se puede mover una carpeta dentro de sí misma o de una subcarpeta suya",
                )
        folder.parent_id = new_parent_id
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = _get_folder_or_404(db, folder_id)
    for file in folder.files:
        blob = STORAGE_DIR / file.storage_path
        blob.unlink(missing_ok=True)
    db.delete(folder)
    db.commit()


@router.post("/files/upload", response_model=FileOut)
async def upload_file(
    folder_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    _get_folder_or_404(db, folder_id)

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
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/files/{file_id}/download")
def download_file(file_id: int, db: Session = Depends(get_db)):
    entry = db.get(FileEntry, file_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    blob = STORAGE_DIR / entry.storage_path
    if not blob.exists():
        raise HTTPException(status_code=404, detail="File blob missing")
    return FileResponse(blob, filename=entry.name, media_type=entry.content_type or "application/octet-stream")


@router.patch("/files/{file_id}", response_model=FileOut)
def update_file(file_id: int, payload: FileRename, db: Session = Depends(get_db)):
    entry = db.get(FileEntry, file_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    if payload.name is not None:
        entry.name = payload.name
    if payload.folder_id is not None:
        _get_folder_or_404(db, payload.folder_id)
        entry.folder_id = payload.folder_id
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db)):
    entry = db.get(FileEntry, file_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="File not found")
    blob = STORAGE_DIR / entry.storage_path
    blob.unlink(missing_ok=True)
    db.delete(entry)
    db.commit()
