#!/usr/bin/env bash
#
# Actualiza el backend en el servidor y reinicia el servicio.
#
# Se ejecuta EN el VPS:
#   cd /opt/soweb && git pull && ./deploy/deploy.sh
#
# No compila el frontend a propósito: ese servidor tiene ~950 MB de RAM sin
# swap y comparte lugar con otros servicios, así que un `npm ci` podría
# disparar el OOM killer y matar alguno de ellos. El frontend se compila en
# una máquina de desarrollo y se sube ya construido — ver deploy/publish.sh,
# que hace las dos cosas de una.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="/var/lib/soweb"
SERVICE="soweb"

echo "==> Repositorio: $REPO_DIR"
install -d -o soweb -g soweb "$DATA_DIR" "$DATA_DIR/storage"

echo "==> Backend: dependencias"
cd "$REPO_DIR/backend"
if [ ! -d .venv ]; then
    python3 -m venv .venv
fi
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt

echo "==> Reiniciando $SERVICE"
systemctl restart "$SERVICE"

echo "==> Verificando"
# El arranque tarda unos segundos, y no siempre los mismos: esperar un plazo
# fijo daba por caído un backend que todavía estaba levantando, y ese falso
# fallo cortaba el resto del despliegue.
for _ in $(seq 30); do
    if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        echo "OK: el backend responde."
        exit 0
    fi
    sleep 1
done

echo "FALLA: el backend no respondió en 30s. Revisá: journalctl -u $SERVICE -n 50"
exit 1
