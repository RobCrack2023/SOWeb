#!/usr/bin/env bash
#
# Publica una versión nueva. Se ejecuta EN TU MÁQUINA, no en el VPS:
#
#   bash deploy/publish.sh
#
# Compila el frontend acá y sube solo el resultado. El servidor tiene poca RAM
# y no swap, y comparte lugar con otros servicios: compilar allá podría
# disparar el OOM killer y matar alguno de ellos.
#
# Da por hecho el atajo `soweb-vps` en ~/.ssh/config.

set -euo pipefail

REMOTE="${SOWEB_REMOTE:-soweb-vps}"
WEB_ROOT="/var/www/soweb"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Servidor: $REMOTE"
ssh -o BatchMode=yes "$REMOTE" true || {
    echo "No se pudo conectar a '$REMOTE'. Revisá ~/.ssh/config."
    exit 1
}

echo "==> Compilando el frontend acá"
cd "$REPO_DIR/frontend"
npm run build

echo "==> Subiendo a $WEB_ROOT"
# tar por ssh en vez de rsync: rsync no viene con Git Bash en Windows.
# El destino se vacía primero para que no queden bundles viejos.
tar -czf - -C dist . | ssh "$REMOTE" \
    "rm -rf $WEB_ROOT/* && tar -xzf - -C $WEB_ROOT \
     && chown -R root:root $WEB_ROOT \
     && find $WEB_ROOT -type d -exec chmod 755 {} \; \
     && find $WEB_ROOT -type f -exec chmod 644 {} \;"

echo "==> Actualizando el backend en el servidor"
ssh "$REMOTE" "cd /opt/soweb && git pull --quiet && ./deploy/deploy.sh"

echo "==> Verificando desde afuera"
if curl -fsS --max-time 15 https://soweb.iot-robotics.cl/api/health >/dev/null; then
    echo "OK: https://soweb.iot-robotics.cl responde."
else
    echo "FALLA: el sitio no responde."
    exit 1
fi
