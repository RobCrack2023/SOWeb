# SOWeb

Un "sistema operativo" de escritorio dentro del navegador: ventanas arrastrables/redimensionables, explorador de archivos con persistencia real en backend, y una suite ofimática propia (procesador de texto, hoja de cálculo, presentaciones y editor de PDF) compatible con los formatos de Microsoft Office.

Es el primer paso hacia la idea de "un SO en el navegador": hoy resuelve el shell (escritorio, ventanas, archivos) y las apps de productividad; a futuro se plantea sumar autenticación multiusuario y, más adelante, ejecución de programas nativos vía emulación o streaming.

## Características

- **Cuentas de usuario**: registro propio con usuario y contraseña, e inicio de sesión. **Cada cuenta tiene su propio Escritorio y sus propios archivos**, invisibles para las demás. Las contraseñas se guardan hasheadas (PBKDF2-SHA256) y la sesión usa un token revocable guardado en el servidor.
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
│       ├── models.py      modelos ORM: User, Session, Folder, FileEntry
│       ├── schemas.py     esquemas Pydantic
│       ├── database.py    engine/sesión de SQLAlchemy + migración de columnas
│       ├── auth.py        hashing de contraseñas y dependencia de sesión
│       └── routers/
│           ├── auth.py    registro, login, logout
│           └── files.py   endpoints de carpetas y archivos (por usuario)
│
└── frontend/           SPA (React 19 + TypeScript + Vite)
    └── src/
        ├── auth/           LoginScreen (registro e inicio de sesión)
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
        │   ├── auth.ts               token de sesión y llamadas de login
        │   ├── fsStore.ts            estado del sistema de archivos (zustand)
        │   ├── dnd.ts, dropUpload.ts, useExternalDrop.ts   drag & drop
        │   └── office/                import/export .docx, .xlsx, .pptx
        └── ui/              componentes compartidos (menú contextual, overlays, etc.)
```

El frontend habla con el backend mediante una API REST (`/api/...`); el backend persiste la estructura de carpetas/archivos en SQLite (`soweb.db`) y los contenidos de archivo en disco. Salvo los endpoints de `/api/auth`, todos exigen un token de sesión (`Authorization: Bearer …`) y solo operan sobre los archivos de esa cuenta.

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

Al arrancar crea las tablas en `soweb.db` si no existen, y agrega las columnas que falten en bases de datos de versiones anteriores. El "Escritorio" de cada usuario se crea al registrarse.

### Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Abrir [http://localhost:5173](http://localhost:5173). El backend debe estar corriendo en el puerto 8000 (CORS ya configurado para `localhost:5173`).

La primera vez aparece la pantalla de acceso: usá "Registrate" para crear una cuenta (usuario de 3+ caracteres, contraseña de 6+) y entrás directo al escritorio. La sesión queda guardada en el navegador, así que recargar no vuelve a pedir la contraseña.

### Windows

También hay un `run.bat` en la raíz para levantar el proyecto rápidamente en Windows.

## API del backend

### Autenticación (`backend/app/routers/auth.py`)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/register` | Crear cuenta; devuelve token de sesión |
| POST | `/api/auth/login` | Iniciar sesión; devuelve token de sesión |
| POST | `/api/auth/logout` | Revocar el token actual |
| GET | `/api/auth/me` | Datos del usuario conectado |

La primera cuenta que se registre adopta el escritorio y los archivos que ya existieran de antes de agregar el login; las cuentas siguientes arrancan con un escritorio vacío.

### Archivos (`backend/app/routers/files.py`)

Todos requieren la cabecera `Authorization: Bearer <token>` y actúan solo sobre los archivos del usuario conectado (prefijo `/api`):

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/folders/desktop-id` | ID del "Escritorio" de esa cuenta |
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

Además: `GET /api/health` para chequeo de salud del servicio (no requiere sesión).

## Próximos pasos

- Endurecer la autenticación: expiración de sesiones, cambio de contraseña, límite de intentos de login.
- Más apps de escritorio.
- Ejecución de `.exe`: emulación x86 en WASM (v86/WebVM) o streaming remoto de una VM Windows.
