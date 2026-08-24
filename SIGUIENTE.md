# Dónde quedamos

Última sesión: **23 de agosto de 2026**. Para el detalle de qué hace cada
parte, el [README](README.md). Esto es solo el estado y lo que sigue.

## En una línea

SOWeb está **en producción** en <https://soweb.iot-robotics.cl>, con la versión
`c48175a`, y **todavía no tiene ninguna cuenta creada**.

## Lo primero, mañana

**Entrá y registrate.** La primera cuenta que se cree queda como
administradora, así que conviene que sea la tuya antes que la de nadie más.

Vas a necesitar el **código de invitación**: está en `/etc/soweb.env` del
servidor, en `SOWEB_INVITE_CODE`. Para verlo:

```bash
ssh soweb-vps 'grep INVITE /etc/soweb.env'
```

## Cosas que conviene tener guardadas

| Qué | Dónde |
|---|---|
| Sitio | <https://soweb.iot-robotics.cl> |
| Servidor | `ssh soweb-vps` (45.7.231.250, puerto 22222, usuario root) |
| Código de invitación | `/etc/soweb.env` → `SOWEB_INVITE_CODE` |
| Clave de cifrado | `/etc/soweb.env` → `SOWEB_SECRET_KEY` |
| Datos (base y archivos) | `/var/lib/soweb/` |
| Respaldos | `/var/backups/soweb/`, diarios a las 3 AM |
| Certificado | Vence el 22/11/2026, se renueva solo |

> **La clave de cifrado no está respaldada fuera del servidor.** Protege las
> contraseñas de correo que la gente guarde en mailSO. Si el VPS se pierde y
> no tenés copia, esas contraseñas quedan ilegibles y hay que volver a
> cargarlas. Copiala a algún lugar seguro — es lo más urgente de esta lista.

## Cómo trabajar

**En tu máquina**, dos terminales:

```bash
cd backend && .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm run dev
```

Abrir <http://localhost:5173>. Vite hace de proxy de `/api` al backend, así que
el navegador ve un solo origen, igual que en producción.

**Para publicar los cambios**, desde la raíz del proyecto:

```bash
bash deploy/publish.sh
```

Compila el frontend acá, sube solo el resultado, actualiza el backend en el
servidor y verifica que el sitio responda. **No compiles en el VPS**: tiene
957 MB de RAM sin swap y comparte máquina con otros servicios; un `npm ci` allá
puede disparar el OOM killer y matar cualquiera de ellos.

## Qué falta

Ordenado por lo que más rinde primero.

### Operación

- **Copiar la clave de cifrado fuera del servidor.** Ver el recuadro de arriba.
- **Respaldos fuera del VPS.** Hoy `deploy/backup.sh` guarda en el mismo disco:
  cubre un borrado accidental, no que el servidor se pierda.
- **Agregar swap al VPS.** Con 957 MB y varios servicios encima, un pico de
  memoria hoy termina en el OOM killer eligiendo víctima. No lo hice porque es
  un cambio al sistema que compartís con otras cosas tuyas.

### Producto

- **Expiración de sesiones.** Un token vive hasta que se cierra sesión o se
  cambia la contraseña. Falta que caduquen solos.
- **waSO**: adjuntar archivos del Drive a un mensaje, buscar en el historial,
  confirmaciones de lectura.
- **mailSO**: adjuntar al enviar, buscar en el buzón, mover entre carpetas.
  OAuth2 para Gmail evitaría la contraseña de aplicación.
- **Panel de administración**: cerrar sesiones de forma remota, dar de baja
  usuarios, filtrar la actividad por fecha.

### Ideas conversadas

- **Correo temporal** (direcciones que duren un mes). Quedó pendiente porque
  hacía falta un dominio, y **ahora lo tenés**: con Cloudflare Email Routing
  sobre `iot-robotics.cl` se puede armar sin servidor de correo propio, y buena
  parte de mailSO se reutiliza.
- **Navegador dentro de SOWeb.** Lo descartamos: la mayoría de los sitios
  grandes prohíben mostrarse dentro de otra página, así que haría falta un
  proxy con sus propios riesgos (SSRF, y páginas ajenas sirviéndose desde el
  origen de SOWeb).

## Un detalle del servidor

Ese VPS **no es solo de SOWeb**: corre nginx con cinco sitios, MinIO, webmin y
otra app FastAPI (viaticos, en el puerto 8001). SOWeb usa el 8000 y su propio
archivo de sitio en nginx; nada de lo demás se tocó. El respaldo de la
configuración de nginx previa quedó en `/root/nginx-backup-20260823-230127`.

Si algo falla:

```bash
ssh soweb-vps 'journalctl -u soweb -n 50 --no-pager'
```
