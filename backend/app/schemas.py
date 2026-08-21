from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Credentials(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_admin: bool


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


# --- Admin panel ---------------------------------------------------------


class ActivityReport(BaseModel):
    """An event the browser reports about itself (which app was opened)."""

    action: str
    detail: str | None = None


class AdminOverview(BaseModel):
    users: int
    online: int
    folders: int
    files: int
    storage_bytes: int
    actions_today: int


class AdminUser(BaseModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime
    online: bool
    last_seen: datetime | None
    files: int
    folders: int
    storage_bytes: int


class AdminSession(BaseModel):
    user_id: int
    username: str
    started_at: datetime
    last_seen: datetime
    online: bool


class AdminActivity(BaseModel):
    id: int
    user_id: int
    username: str
    action: str
    detail: str | None
    created_at: datetime


class AdminFile(BaseModel):
    """A file listed for an admin: metadata only, never its contents."""

    id: int
    name: str
    folder: str
    size: int
    content_type: str | None
    created_at: datetime
