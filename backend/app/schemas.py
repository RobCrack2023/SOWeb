from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str


class LoginOut(BaseModel):
    token: str
    user: UserOut


class FolderCreate(BaseModel):
    name: str
    parent_id: int | None = None


class FolderRename(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    pos_x: int | None = None
    pos_y: int | None = None


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    parent_id: int | None
    created_at: datetime
    pos_x: int | None
    pos_y: int | None
    type: str = "folder"


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    folder_id: int
    size: int
    content_type: str | None
    created_at: datetime
    pos_x: int | None
    pos_y: int | None
    type: str = "file"


class FileRename(BaseModel):
    name: str | None = None
    folder_id: int | None = None
    pos_x: int | None = None
    pos_y: int | None = None


class FileCreate(BaseModel):
    name: str
    folder_id: int
    content: str = ""
    content_type: str = "application/x-soweb-document"


class FileContentOut(BaseModel):
    id: int
    name: str
    folder_id: int
    content_type: str | None
    content: str


class FileContentUpdate(BaseModel):
    content: str


class FolderContents(BaseModel):
    folder: FolderOut | None
    breadcrumb: list[FolderOut]
    folders: list[FolderOut]
    files: list[FileOut]
