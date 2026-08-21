"""Small admin CLI for SOWeb.

    python manage.py list
    python manage.py promote <usuario>
    python manage.py demote <usuario>
"""

import sys

from app.database import SessionLocal
from app.models import User


def cmd_list() -> int:
    with SessionLocal() as db:
        users = db.query(User).order_by(User.username).all()
        if not users:
            print("No hay usuarios registrados todavía.")
            return 0
        width = max(len(u.username) for u in users)
        for user in users:
            role = "admin" if user.is_admin else "usuario"
            print(f"{user.username.ljust(width)}  {role}")
    return 0


def _set_admin(username: str, value: bool) -> int:
    with SessionLocal() as db:
        user = db.query(User).filter(User.username == username).first()
        if user is None:
            print(f"No existe el usuario '{username}'.")
            return 1
        if user.is_admin == value:
            print(f"'{username}' ya {'es' if value else 'no es'} admin; sin cambios.")
            return 0
        # Don't let the last admin remove their own access to the panel.
        if not value and db.query(User).filter(User.is_admin.is_(True)).count() <= 1:
            print("No se puede quitar el último admin: quedaría nadie con acceso al panel.")
            return 1
        user.is_admin = value
        db.commit()
        print(f"'{username}' ahora {'es admin' if value else 'es usuario normal'}.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] not in {"list", "promote", "demote"}:
        print(__doc__)
        return 1
    if argv[1] == "list":
        return cmd_list()
    if len(argv) < 3:
        print(f"Falta el nombre de usuario: python manage.py {argv[1]} <usuario>")
        return 1
    return _set_admin(argv[2], argv[1] == "promote")


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
