from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String, DateTime, BigInteger, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Folder(Base):
    __tablename__ = "folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("folders.id"), nullable=True)
    is_desktop: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    parent: Mapped["Folder | None"] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list["Folder"]] = relationship(back_populates="parent", cascade="all, delete-orphan")
    files: Mapped[list["FileEntry"]] = relationship(back_populates="folder", cascade="all, delete-orphan")


class FileEntry(Base):
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id"))
    size: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_path: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    folder: Mapped["Folder"] = relationship(back_populates="files")
