# SOWeb

Un "sistema operativo" de escritorio dentro del navegador: ventanas arrastrables/redimensionables, explorador de archivos con persistencia real en backend, y una suite ofimática propia (procesador de texto, hoja de cálculo, presentaciones y editor de PDF) compatible con los formatos de Microsoft Office.

Es el primer paso hacia la idea de "un SO en el navegador": hoy resuelve el shell (escritorio, ventanas, archivos) y las apps de productividad; a futuro se plantea sumar autenticación multiusuario y, más adelante, ejecución de programas nativos vía emulación o streaming.

## Características

- **Cuentas de usuario**: registro propio con usuario y contraseña, e inicio de sesión. **Cada cuenta tiene su propio Escritorio y sus propios archivos**, invisibles para las demás. Las contraseñas se guardan hasheadas (PBKDF2-SHA256) y la sesión usa un token revocable guardado en el servidor.
- **Panel de administración** (🛡️, solo para cuentas admin): quién está conectado ahora, qué archivos creó cada usuario, cuánto espacio ocupa y un registro de actividad (inicios de sesión, archivos creados/guardados/subidos/eliminados, y qué apps se abren). Muestra únicamente metadatos: el admin no puede abrir ni descargar documentos de otras cuentas, ni leer conversaciones de waSO — de los mensajes solo ve cuántos hubo.
- **Escritorio y gestor de ventanas**: iconos de escritorio, menú de inicio, barra de tareas, ventanas arrastrables y redimensionables (`react-rnd`), con el contenido recortado correctamente al marco de la ventana.
- **Accesorios de escritorio**: calendario con eventos y recordatorios (avisan solos en la esquina), notas adhesivas que se pegan al escritorio y se guardan solas mientras escribís, y calculadora con historial.
- **Papelera, búsqueda y contraseña**: borrar manda a la papelera y se puede restaurar (una carpeta vuelve con todo su contenido); nada se borra del disco hasta vaciarla. Búsqueda por nombre en todo el drive, con la ruta de cada resultado. Y cada quien puede cambiar su propia contraseña, lo que además cierra las sesiones abiertas en otros equipos.
- **Compartir archivos entre cuentas**: enviar un archivo a otro usuario con un mensaje. Le llega una copia a su carpeta «Recibidos» y un aviso por waSO. Es una copia, no acceso compartido: quien la recibe pasa a ser su dueño.
- **Explorador de archivos (Drive)**: carpetas y archivos persistidos en una base de datos real (no solo en memoria), con crear/renombrar/mover/eliminar, subida de archivos y **drag & drop desde el escritorio real del sistema operativo** hacia el explorador web.
- **writeSO** — procesador de texto (basado en Tiptap): formato enriquecido, tablas, alineación, subrayado y color; **guarda directamente en `.docx`**, abrible en Word o Google Docs sin exportar. Como los lectores de `.docx` descartan el formato directo al releer, el documento del editor viaja incrustado dentro del paquete y writeSO lo recupera sin perder color ni alineación (ver más abajo). Maneja tamaños de página.
- **spreadSO** — hoja de cálculo con motor de fórmulas propio y **libros de varias hojas** (pestañas para crear, renombrar y eliminar), incluidas referencias entre hojas (`Ventas!B4`, o `'Resumen 2026'!B3` si el nombre lleva espacios); **guarda directamente en `.xlsx`**, así que los archivos sirven fuera de SOWeb (Excel, LibreOffice, Sheets) sin exportar nada. Conserva todas las hojas, sus fórmulas y el formato de celda (color de relleno, color de letra, negrita/cursiva) (vía `exceljs`). La grilla crece según el contenido y dibuja solo las filas visibles, así que un libro de miles de filas se abre sin trabarse.
- **showSO** — editor de presentaciones con modo presentador; **guarda directamente en `.pptx`** (vía `pptxgenjs`), y lo relee conservando texto, posición, tamaño, negrita, cursiva, alineación, color y fondo.
- **waSO** — chat entre cuentas de SOWeb, en tiempo real por WebSocket: conversaciones 1 a 1 y grupos, historial persistido, contador de no leídos en la barra de tareas, indicador de "escribiendo…", presencia en línea y **stickers animados** (emoji + animación CSS, sin archivos de imagen).
- **mailSO** — cliente de correo para cuentas que ya tengas: IMAP o POP3 para leer, SMTP para enviar, con ajustes precargados para Gmail, Outlook y Yahoo. Carpetas, lista paginada, adjuntos, responder y eliminar. Las contraseñas se guardan cifradas y el HTML de cada mensaje se muestra aislado (ver más abajo).
- **Visor y editor para el resto de los archivos**: imágenes con zoom y arrastre, reproductor de audio y video, y un editor de texto plano y código con numeración de líneas. Antes, cualquier archivo que no fuera de oficina solo se podía descargar.
- **pdfSO** — visor y editor de PDF: edición de texto sobre el PDF que conserva la posición y apariencia original del texto reemplazado (vía `pdf-lib` + `pdfjs-dist`).
- Todas las apps ofimáticas soportan múltiples instancias abiertas a la vez.

## Arquitectura

```
SOWeb/
├── backend/           API REST (FastAPI + SQLAlchemy + SQLite)
│   ├── manage.py      CLI: listar usuarios, promover/quitar admin
│   └── app/
│       ├── main.py        punto de entrada, CORS, montaje de routers
│       ├── settings.py    configuración por variables de entorno
│       ├── models.py      modelos ORM: User, Session, Activity, Folder, FileEntry
│       ├── schemas.py     esquemas Pydantic
│       ├── database.py    engine/sesión de SQLAlchemy + migración de columnas
│       ├── auth.py        hashing de contraseñas y dependencias de sesión/admin
│       ├── activity.py    registro de acciones para el panel de administración
│       ├── chathub.py     sockets de chat abiertos, en memoria
│       ├── crypto.py      cifrado de las contraseñas de correo guardadas
│       ├── mail/          cliente IMAP/POP3, parseo MIME y envío SMTP
│       └── routers/
│           ├── auth.py      registro, login, logout
│           ├── files.py     endpoints de carpetas y archivos (por usuario)
│           ├── activity.py  eventos que reporta el navegador (apps abiertas)
│           ├── chat.py      waSO: conversaciones, mensajes y WebSocket
│           ├── mail.py      mailSO: cuentas, carpetas, mensajes y envío
│           ├── desk.py      notas adhesivas y calendario
│           └── admin.py     supervisión: usuarios, sesiones, actividad
│
├── deploy/            nginx, systemd, scripts de despliegue y respaldo
│
└── frontend/           SPA (React 19 + TypeScript + Vite)
    └── src/
        ├── auth/           LoginScreen (registro e inicio de sesión)
        ├── desktop/        Desktop, DesktopIcon, StartMenu, Taskbar
        ├── windows/        Window (marco de ventana) y windowStore (zustand)
        ├── apps/
        │   ├── admin/           Panel de administración
        │   ├── calculator/      Calculadora
        │   ├── calendar/        Calendario con recordatorios
        │   ├── chat/            waSO (chat, stickers animados)
        │   ├── file-explorer/   Explorador de archivos
        │   ├── mail/            mailSO (cliente de correo)
        │   ├── text-editor/     writeSO
        │   ├── spreadsheet/     spreadSO
        │   ├── presentation/    showSO
        │   ├── pdf/              pdfSO
        │   ├── viewer/           visor de imágenes/audio/video y editor de código
        │   └── registry.tsx      registro central de apps instalables
        ├── lib/
        │   ├── api.ts, filesApi.ts   cliente HTTP hacia el backend
        │   ├── auth.ts               token de sesión y llamadas de login
        │   ├── chatApi.ts, chatSocket.ts, chatStore.ts   waSO
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

Abrir [http://localhost:5173](http://localhost:5173). El backend debe estar corriendo en el puerto 8000: Vite hace de proxy de `/api` hacia él, así que el navegador ve un solo origen — igual que en producción, y sin CORS de por medio.

La primera vez aparece la pantalla de acceso: usá "Registrate" para crear una cuenta (usuario de 3+ caracteres, contraseña de 6+) y entrás directo al escritorio. La sesión queda guardada en el navegador, así que recargar no vuelve a pedir la contraseña.

La **primera cuenta que registres queda como administradora** y ve un icono extra 🛡️ Administración en el escritorio.

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
| POST | `/api/auth/password` | Cambiar la propia contraseña (revoca las demás sesiones) |

La primera cuenta que se registre adopta el escritorio y los archivos que ya existieran de antes de agregar el login, **y queda como administradora**; las cuentas siguientes arrancan con un escritorio vacío y sin permisos de admin.

### Chat / waSO (`backend/app/routers/chat.py`)

Todos requieren sesión y solo operan sobre conversaciones de las que el usuario es miembro; el resto responde 404.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/chat/contacts` | Usuarios con los que se puede conversar |
| GET | `/api/chat/conversations` | Conversaciones con no leídos y último mensaje |
| POST | `/api/chat/direct/{user_id}` | Abre (o encuentra) el chat 1 a 1 con alguien |
| POST | `/api/chat/groups` | Crea un grupo |
| POST | `/api/chat/groups/{id}/members` | Suma personas a un grupo |
| DELETE | `/api/chat/groups/{id}/members/me` | Salir de un grupo |
| GET | `/api/chat/conversations/{id}/messages` | Historial |
| POST | `/api/chat/conversations/{id}/messages` | Envía texto o sticker |
| POST | `/api/chat/conversations/{id}/read` | Marca la conversación como leída |
| WS | `/api/chat/ws` | Entrega en vivo, presencia y "escribiendo…" |

El WebSocket recibe el token en el **primer mensaje**, no en la URL, para que no quede registrado en el historial del navegador ni en los logs del servidor. El registro de sockets abiertos vive en memoria del proceso: correr varios workers de uvicorn requeriría un bus compartido (por ejemplo Redis pub/sub).

### Correo / mailSO (`backend/app/routers/mail.py`)

Todos requieren sesión y solo alcanzan las cuentas de correo del propio usuario.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/mail/accounts` | Cuentas configuradas (nunca devuelve contraseñas) |
| POST | `/api/mail/accounts` | Agregar cuenta |
| PUT | `/api/mail/accounts/{id}` | Editar cuenta (contraseña vacía = sin cambios) |
| DELETE | `/api/mail/accounts/{id}` | Quitar cuenta |
| POST | `/api/mail/accounts/test` | Probar la configuración antes de guardarla |
| GET | `/api/mail/accounts/{id}/folders` | Carpetas del buzón |
| GET | `/api/mail/accounts/{id}/messages` | Lista paginada (`folder`, `limit`, `offset`) |
| GET | `/api/mail/accounts/{id}/messages/{uid}` | Mensaje completo |
| GET | `.../messages/{uid}/attachments/{i}` | Descargar un adjunto |
| POST | `.../messages/{uid}/seen` | Marcar leído / no leído |
| DELETE | `/api/mail/accounts/{id}/messages/{uid}` | Eliminar del servidor |
| POST | `/api/mail/accounts/{id}/send` | Enviar por SMTP |

#### Conectar Gmail

Gmail dejó de aceptar la contraseña normal por IMAP. Hay que activar la **verificación en 2 pasos** en la cuenta de Google, generar una **contraseña de aplicación** y usar esa en mailSO. También conviene confirmar que IMAP esté habilitado en la configuración de Gmail. Outlook y Yahoo piden lo mismo cuando tienen 2FA activo.

#### Por qué un .docx lleva algo extra adentro

Los lectores de `.docx` (mammoth, el que usa writeSO) convierten el documento
*semánticamente* y descartan el formato directo: color de texto, alineación de
párrafo y sombreado de encabezados de tabla se pierden al releer. Como writeSO
ahora guarda en `.docx`, eso significaría perder esos atributos en cada
guardado.

Por eso el documento del editor viaja como una parte extra dentro del paquete
(`soweb/document.json`). Word y cualquier otro lector la ignoran; writeSO la usa
para reabrir sus propios archivos sin pérdida. Solo se confía en ella si nadie
más escribió el archivo desde entonces: cualquier otro editor reescribe
`lastModifiedBy`, y a partir de ahí manda lo que ese editor dejó escrito.

showSO no necesita nada de esto: su modelo (texto, posición, tamaño, negrita,
cursiva, alineación, color, fondo) se escribe y se relee completo desde el
`.pptx`.

#### Cómo se protege

- **Contraseñas cifradas** con Fernet (`backend/app/crypto.py`). La clave vive fuera de la base: en la variable `SOWEB_SECRET_KEY` o, si no está, en `backend/.secret_key` (ignorado por git). Robar `soweb.db` no alcanza para leerlas. Si perdés la clave hay que volver a cargar las contraseñas; no se pierde correo, que vive en el servidor del proveedor.
- **El HTML del correo nunca toca el DOM de SOWeb**: se muestra dentro de un `iframe` con `sandbox` sin `allow-scripts` ni `allow-same-origin`, y con un CSP `default-src 'none'`. El JavaScript de un mensaje no puede ejecutarse.
- **Imágenes remotas bloqueadas** hasta que el lector las pida, porque cargarlas le avisa al remitente que abriste el mensaje.
- **Los adjuntos se descargan siempre como `attachment`**, nunca en línea, para que el navegador no ejecute HTML o SVG ajeno en este origen.
- El registro de actividad guarda que hubo un envío, nunca destinatarios ni contenido.

### Administración (`backend/app/routers/admin.py`)

Requieren una cuenta admin; para el resto responden 403.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/overview` | Totales: usuarios, conectados, archivos, espacio, acciones |
| GET | `/api/admin/users` | Un renglón por usuario con sus estadísticas |
| GET | `/api/admin/sessions` | Sesiones abiertas y cuál está activa |
| GET | `/api/admin/activity` | Registro de acciones (opcional `?user_id=`) |
| GET | `/api/admin/users/{user_id}/files` | Metadatos de los archivos de un usuario |
| POST | `/api/activity` | El navegador reporta qué app abrió (no requiere admin) |

Ninguno de estos endpoints devuelve el contenido de un archivo ni de un mensaje: un admin que pida `/api/files/{id}/content` de otra cuenta recibe 404 igual que cualquier usuario, y del chat solo obtiene recuentos. En el registro de actividad, un `chat.send` se guarda sin el texto del mensaje.

#### Gestionar administradores

```bash
python manage.py list
```

`python manage.py promote <usuario>` y `python manage.py demote <usuario>` cambian el rol (se ejecutan dentro de `backend/`, con el entorno virtual activado). No permite quitar el último admin.

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
| PUT | `/files/{file_id}/content` | Actualizar contenido de texto |
| PUT | `/files/{file_id}/binary` | Reemplazar los bytes (guardado de .xlsx) |
| POST | `/files/upload` | Subir archivo binario |
| GET | `/files/{file_id}/download` | Descargar archivo |
| PATCH | `/files/{file_id}` | Renombrar/mover archivo |
| DELETE | `/files/{file_id}` | Mandar archivo a la papelera |
| GET | `/search?q=` | Buscar carpetas y archivos por nombre |
| GET | `/trash` | Contenido de la papelera |
| POST | `/trash/{folders\|files}/{id}/restore` | Restaurar |
| DELETE | `/trash/{folders\|files}/{id}` | Eliminar definitivamente |
| DELETE | `/trash` | Vaciar la papelera |

Además: `GET /api/health` para chequeo de salud del servicio (no requiere sesión).

## Puesta en producción

El repo trae en `deploy/` todo lo necesario. El esquema es: nginx sirve el
frontend compilado y hace de proxy al backend bajo `/api`, así que **todo vive
en un mismo origen** — sin CORS, y el WebSocket de waSO viaja como `wss://`
por la misma conexión TLS.

```
/opt/soweb        el repositorio
/var/www/soweb    el frontend compilado
/var/lib/soweb    base de datos y archivos (sobreviven a cada despliegue)
/etc/soweb.env    configuración y secretos
```

Pasos, una sola vez:

1. Crear el usuario del servicio y los directorios:
   `sudo useradd -r -s /usr/sbin/nologin soweb && sudo install -d -o soweb -g soweb /var/lib/soweb`
2. Clonar el repo en `/opt/soweb`.
3. Copiar `deploy/soweb.env.example` a `/etc/soweb.env`, generar la clave de
   cifrado y elegir el código de invitación. **Guardá una copia de la clave**:
   sin ella las contraseñas de correo guardadas quedan ilegibles.
4. Instalar `deploy/soweb.service`, `deploy/nginx.conf` y
   `deploy/nginx-upgrade-map.conf` (cada archivo trae sus instrucciones arriba).
5. Emitir el certificado: `sudo certbot --nginx -d tu-dominio`.
6. Programar `deploy/backup.sh` en cron.

Cada actualización posterior:

```bash
cd /opt/soweb && sudo -u soweb git pull && sudo ./deploy/deploy.sh
```

### Detalles que importan

- **Un solo worker de uvicorn.** El registro de sockets de waSO vive en memoria
  del proceso: con varios workers, quien esté conectado a uno no recibiría los
  mensajes que entran por otro. Escalar a más de uno pide un bus compartido
  (Redis pub/sub).
- **HTTPS no es opcional.** Por la conexión viajan contraseñas de SOWeb, tokens
  de sesión y las credenciales de correo de mailSO.
- **Registro cerrado por código.** Con `SOWEB_INVITE_CODE` puesto, crear cuenta
  exige ese código; la pantalla de acceso pregunta al servidor si hace falta y
  muestra el campo solo entonces. Vacío = registro abierto a cualquiera.
- **Intentos de login limitados** por usuario (8 en 5 minutos por defecto),
  para que la pantalla de acceso no sea un blanco fácil de fuerza bruta.
- **SQLite** aguanta bien este uso; si algún día hay muchas escrituras a la vez,
  el cambio natural es PostgreSQL.

## Próximos pasos

- Endurecer la autenticación: expiración automática de sesiones (hoy un token vive hasta que se cierra sesión o se cambia la contraseña).
- Panel de administración: cerrar sesiones de forma remota, dar de baja usuarios, filtrar el registro de actividad por fecha.
- waSO: adjuntar archivos del Drive a un mensaje, buscar en el historial, confirmaciones de lectura y notificaciones del navegador.
- mailSO: adjuntar archivos al enviar, buscar en el buzón, mover mensajes entre carpetas y OAuth2 para Gmail (evitaría la contraseña de aplicación).
- Más apps de escritorio.
- Ejecución de `.exe`: emulación x86 en WASM (v86/WebVM) o streaming remoto de una VM Windows.
