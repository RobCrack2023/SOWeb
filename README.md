# SOWeb

Escritorio web con ventanas + explorador de archivos (Drive), primer paso hacia un "SO en el navegador".

## Backend (FastAPI)

```
cd backend
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt
./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

## Frontend (React + Vite)

```
cd frontend
npm install
npm run dev
```

Abrir http://localhost:5173. El backend debe estar corriendo en el puerto 8000 (CORS ya configurado).

## Próximos pasos

- Login / gestión de usuarios.
- Más apps de escritorio (editor de texto, "suite ofimática").
- Ejecución de `.exe`: emulación x86 en WASM (v86/WebVM) o streaming remoto de una VM Windows.
