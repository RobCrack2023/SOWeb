from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import settings
from .database import Base, engine, ensure_schema
from .routers import activity, admin, auth, chat, desk, files, mail

Base.metadata.create_all(bind=engine)
ensure_schema()

app = FastAPI(title="SOWeb API")

# Served from its own origin behind a reverse proxy, the frontend needs no
# CORS at all; the middleware is only added when origins are configured.
if settings.CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(auth.router)
app.include_router(files.router)
app.include_router(activity.router)
app.include_router(chat.router)
app.include_router(mail.router)
app.include_router(desk.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
