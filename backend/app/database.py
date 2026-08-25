from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import settings

DB_PATH = settings.DB_PATH
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema() -> None:
    """create_all() only creates missing tables, not missing columns on
    existing ones. Add any columns introduced after the table already
    existed on disk (SQLite supports simple ADD COLUMN)."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in (
            (
                "folders",
                {"pos_x": "INTEGER", "pos_y": "INTEGER", "owner_id": "INTEGER", "deleted_at": "DATETIME"},
            ),
            ("files", {"pos_x": "INTEGER", "pos_y": "INTEGER", "deleted_at": "DATETIME"}),
            ("users", {"is_admin": "BOOLEAN DEFAULT 0", "email": "VARCHAR(255)"}),
            ("sessions", {"last_seen": "DATETIME"}),
        ):
            if table not in inspector.get_table_names():
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for col, col_type in columns.items():
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))

        # La unicidad del correo va como índice y no como restricción de la
        # tabla: SQLite no permite agregar una con ALTER TABLE, y es también
        # lo que create_all() emite para esa columna, así que la base nueva y
        # la ya existente terminan con el mismo esquema. Varios NULL no chocan
        # entre sí, que es lo que deja convivir a las cuentas sin correo.
        if "users" in inspector.get_table_names():
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)")
            )
