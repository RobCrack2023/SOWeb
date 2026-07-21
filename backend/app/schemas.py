from datetime import datetime

from pydantic import BaseModel, ConfigDict


class FolderCreate(BaseModel):
    name: str
    parent_id: int | None = None


class FolderRename(BaseModel):
    name: str | None = None
    parent_id: int | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    parent_id: int | None
    created_at: datetime
    type: str = "folder"


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    folder_id: int
    size: int
    content_type: str | None
    created_at: datetime
    type: str = "file"


class FileRename(BaseModel):
    name: str | None = None
    folder_id: int | None = None


class FolderContents(BaseModel):
    folder: FolderOut | None
    breadcrumb: list[FolderOut]
    folders: list[FolderOut]
    files: list[FileOut]
