from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import Base, engine, ensure_schema
from .routers import activity, admin, auth, files

Base.metadata.create_all(bind=engine)
ensure_schema()

app = FastAPI(title="SOWeb API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(files.router)
app.include_router(activity.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
