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


# --- Chat (waSO) ---------------------------------------------------------


class ChatContact(BaseModel):
    id: int
    username: str
    online: bool


class ChatMember(BaseModel):
    id: int
    username: str
    online: bool


class ChatMessage(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    sender: str
    kind: str
    body: str
    created_at: datetime


class ChatConversation(BaseModel):
    id: int
    kind: str
    title: str
    members: list[ChatMember]
    unread: int
    last_message: ChatMessage | None


class SendMessage(BaseModel):
    kind: str = "text"
    body: str = Field(min_length=1, max_length=4000)


class CreateGroup(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    member_ids: list[int] = Field(min_length=1)


class AddMembers(BaseModel):
    member_ids: list[int] = Field(min_length=1)


# --- Mail (mailSO) -------------------------------------------------------


class MailAccountIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    protocol: str = "imap"
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    use_ssl: bool = True
    username: str = Field(min_length=1, max_length=255)
    # Optional on update: left empty means "keep the stored one".
    password: str = ""

    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_ssl: bool = False
    smtp_username: str = ""
    smtp_password: str = ""


class MailAccountOut(BaseModel):
    """Never carries a password, in any form."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    email: str
    protocol: str
    host: str
    port: int
    use_ssl: bool
    username: str
    smtp_host: str
    smtp_port: int
    smtp_ssl: bool
    smtp_username: str
    created_at: datetime


class MailAttachment(BaseModel):
    index: int
    filename: str
    content_type: str
    size: int
    inline: bool


class MailEnvelope(BaseModel):
    uid: str
    subject: str
    from_name: str
    from_email: str
    date: str | None
    seen: bool
    has_attachments: bool


class MailListOut(BaseModel):
    messages: list[MailEnvelope]
    total: int


class MailMessageOut(BaseModel):
    uid: str
    subject: str
    from_name: str
    from_email: str
    to: list[str]
    cc: list[str]
    date: datetime | None
    text: str
    html: str
    message_id: str
    attachments: list[MailAttachment]


class SendMailIn(BaseModel):
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    subject: str = ""
    body: str = ""
    in_reply_to: str = ""


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
    # Chat is counted, never read: no endpoint exposes message bodies.
    conversations: int
    messages: int


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
    messages_sent: int


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
