@echo off
cd /d "%~dp0"

start "SOWeb Backend" cmd /k "cd backend && .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000"
start "SOWeb Frontend" cmd /k "cd frontend && npm run dev"

echo Backend en http://localhost:8000
echo Frontend en http://localhost:5173
