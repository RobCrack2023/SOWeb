# SOWeb

Un "sistema operativo" de escritorio dentro del navegador: ventanas arrastrables/redimensionables, explorador de archivos con persistencia real en backend, y una suite ofimática propia (procesador de texto, hoja de cálculo, presentaciones y editor de PDF) compatible con los formatos de Microsoft Office.

Es el primer paso hacia la idea de "un SO en el navegador": hoy resuelve el shell (escritorio, ventanas, archivos) y las apps de productividad; a futuro se plantea sumar autenticación multiusuario y, más adelante, ejecución de programas nativos vía emulación o streaming.

## Características

- **Escritorio y gestor de ventanas**: iconos de escritorio, menú de inicio, barra de tareas, ventanas arrastrables y redimensionables (`react-rnd`), con el contenido recortado correctamente al marco de la ventana.
- **Explorador de archivos (Drive)**: carpetas y archivos persistidos en una base de datos real (no solo en memoria), con crear/renombrar/mover/eliminar, subida de archivos y **drag & drop desde el escritorio real del sistema operativo** hacia el explorador web.
- **writeSO** — procesador de texto (basado en Tiptap): formato enriquecido, tablas, alineación, subrayado y color; importa y exporta `.docx` conservando tablas, color y subrayado; maneja tamaños de página.
- **spreadSO** — hoja de cálculo con motor de fórmulas propio; importa/exporta `.xlsx` (vía `exceljs`).
- **showSO** — editor de presentaciones con modo presentador; exporta a `.pptx` (vía `pptxgenjs`).
- **pdfSO** — visor y editor de PDF: edición de texto sobre el PDF que conserva la posición y apariencia original del texto reemplazado (vía `pdf-lib` + `pdfjs-dist`).
- Todas las apps ofimáticas soportan múltiples instancias abiertas a la vez.

## Arquitectura

```
SOWeb/
├── backend/           API REST (FastAPI + SQLAlchemy + SQLite)
│   └── app/
│       ├── main.py        punto de entrada, CORS, montaje de routers
│       ├── models.py      modelos ORM: Folder, FileEntry
│       ├── schemas.py     esquemas Pydantic
│       ├── database.py    engine/sesión de SQLAlchemy
│       └── routers/
│           └── files.py   endpoints de carpetas y archivos
│
└── frontend/           SPA (React 19 + TypeScript + Vite)
    └── src/
        ├── desktop/        Desktop, DesktopIcon, StartMenu, Taskbar
        ├── windows/        Window (marco de ventana) y windowStore (zustand)
        ├── apps/
        │   ├── file-explorer/   Explorador de archivos
        │   ├── text-editor/     writeSO
        │   ├── spreadsheet/     spreadSO
        │   ├── presentation/    showSO
        │   ├── pdf/              pdfSO
        │   └── registry.tsx      registro central de apps instalables
        ├── lib/
        │   ├── api.ts, filesApi.ts   cliente HTTP hacia el backend
        │   ├── fsStore.ts            estado del sistema de archivos (zustand)
        │   ├── dnd.ts, dropUpload.ts, useExternalDrop.ts   drag & drop
        │   └── office/                import/export .docx, .xlsx, .pptx
        └── ui/              componentes compartidos (menú contextual, overlays, etc.)
```

El frontend habla con el backend mediante una API REST (`/api/...`); el backend persiste la estructura de carpetas/archivos en SQLite (`soweb.db`) y los contenidos de archivo en disco.

## Stack técnico

**Backend**
- [FastAPI](https://fastapi.tiangolo.com/) — framework web
- [SQLAlchemy](https://www.sqlalchemy.org/) (ORM tipado con `Mapped`) + SQLite
- `python-multipart` para subida de archivos
- `uvicorn` como servidor ASGI

**Frontend**
- [React 19](https://react.dev/) + TypeScript + [Vite](https://vitejs.dev/)
- [Zustand](https://github.com/pmndrs/zustand) para estado global (ventanas, sistema de archivos)
- [react-rnd](https://github.com/bokuweb/react-rnd) para ventanas arrastrables/redimensionables
- [Tiptap](https://tiptap.dev/) para el editor de texto enriquecido
- [pdf-lib](https://pdf-lib.js.org/) + [pdfjs-dist](https://mozilla.github.io/pdf.js/) para el motor de PDF
- [docx](https://www.npmjs.com/package/docx), [exceljs](https://www.npmjs.com/package/exceljs), [pptxgenjs](https://www.npmjs.com/package/pptxgenjs), [mammoth](https://www.npmjs.com/package/mammoth), [jszip](https://www.npmjs.com/package/jszip) para interoperabilidad con formatos de Office
- `oxlint` para linting

## Puesta en marcha

### Requisitos

- Python 3.11+ (recomendado)
- Node.js 20+

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt
./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Al arrancar, crea automáticamente las tablas en `soweb.db` (si no existen) y una carpeta raíz "Escritorio".

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Abrir [http://localhost:5173](http://localhost:5173). El backend debe estar corriendo en el puerto 8000 (CORS ya configurado para `localhost:5173`).

### Windows

También hay un `run.bat` en la raíz para levantar el proyecto rápidamente en Windows.

## API del backend

Endpoints expuestos por `backend/app/routers/files.py` (prefijo `/api`):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/folders/desktop-id` | ID de la carpeta raíz "Escritorio" |
| GET | `/folders/contents` | Contenido (subcarpetas + archivos) de una carpeta |
| POST | `/folders` | Crear carpeta |
| PATCH | `/folders/{folder_id}` | Renombrar/mover carpeta |
| DELETE | `/folders/{folder_id}` | Eliminar carpeta |
| POST | `/files` | Crear archivo (contenido inline) |
| GET | `/files/{file_id}/content` | Leer contenido de archivo |
| PUT | `/files/{file_id}/content` | Actualizar contenido de archivo |
| POST | `/files/upload` | Subir archivo binario |
| GET | `/files/{file_id}/download` | Descargar archivo |
| PATCH | `/files/{file_id}` | Renombrar/mover archivo |
| DELETE | `/files/{file_id}` | Eliminar archivo |

Además: `GET /api/health` para chequeo de salud del servicio.

## Próximos pasos

- Login / gestión de usuarios (multiusuario).
- Más apps de escritorio.
- Ejecución de `.exe`: emulación x86 en WASM (v86/WebVM) o streaming remoto de una VM Windows.
