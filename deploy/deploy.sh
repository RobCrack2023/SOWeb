#!/usr/bin/env bash
#
# Publica la versión actual del repositorio en el servidor.
#
# Se ejecuta EN el VPS, desde el directorio del repo:
#   cd /opt/soweb && sudo -u soweb git pull && sudo ./deploy/deploy.sh
#
# Da por hecho el esquema de instalación descrito en el README:
#   /opt/soweb        el repositorio
#   /var/www/soweb    el frontend compilado que sirve nginx
#   /var/lib/soweb    datos que sobreviven a cada despliegue
#   /etc/soweb.env    configuración y secretos

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="/var/www/soweb"
DATA_DIR="/var/lib/soweb"
SERVICE="soweb"

echo "==> Repositorio: $REPO_DIR"

# --- Datos ------------------------------------------------------------------
install -d -o soweb -g soweb "$DATA_DIR" "$DATA_DIR/storage"

# --- Backend ----------------------------------------------------------------
echo "==> Backend: dependencias"
cd "$REPO_DIR/backend"
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt

# --- Frontend ---------------------------------------------------------------
echo "==> Frontend: compilando"
cd "$REPO_DIR/frontend"
npm ci --silent
npm run build

echo "==> Publicando el frontend en $WEB_ROOT"
install -d "$WEB_ROOT"
# --delete deja el directorio igual a dist/, sin bundles viejos acumulados.
rsync -a --delete dist/ "$WEB_ROOT/"

# --- Servicio ---------------------------------------------------------------
echo "==> Reiniciando $SERVICE"
systemctl restart "$SERVICE"
sleep 2
systemctl --no-pager --lines=0 status "$SERVICE"

# Comprobación real de que quedó respondiendo, no solo que systemd lo levantó.
echo "==> Verificando"
if curl -fsS http://127.0.0.1:8000/api/health >/dev/null; then
    echo "OK: el backend responde."
else
    echo "FALLA: el backend no responde. Revisá: journalctl -u $SERVICE -n 50"
    exit 1
fi
