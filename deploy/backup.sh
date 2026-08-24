#!/usr/bin/env bash
#
# Respaldo de SOWeb: la base y los archivos de la gente.
#
# Diario a las 3 de la mañana:
#   sudo crontab -e
#   0 3 * * * /opt/soweb/deploy/backup.sh >> /var/log/soweb-backup.log 2>&1
#
# Esto guarda copias EN EL MISMO servidor, lo que cubre un borrado accidental
# pero no que el servidor se pierda. Copiá /var/backups/soweb a otro lado.

set -euo pipefail

DATA_DIR="/var/lib/soweb"
BACKUP_DIR="/var/backups/soweb"
KEEP_DAYS=14
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

# La base se copia con el comando .backup de sqlite, no con cp: cp puede
# capturar el archivo a mitad de una escritura y dejar una copia corrupta.
echo "[$STAMP] base de datos"
sqlite3 "$DATA_DIR/soweb.db" ".backup '$BACKUP_DIR/soweb-$STAMP.db'"
gzip -f "$BACKUP_DIR/soweb-$STAMP.db"

echo "[$STAMP] archivos"
tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$DATA_DIR" storage

# La clave de cifrado va aparte y casi nunca cambia, pero sin ella las
# contraseñas de correo del respaldo no se pueden leer.
if [ -f /etc/soweb.env ]; then
    cp /etc/soweb.env "$BACKUP_DIR/soweb.env.copia"
    chmod 600 "$BACKUP_DIR/soweb.env.copia"
fi

echo "[$STAMP] limpiando copias de más de $KEEP_DAYS días"
find "$BACKUP_DIR" -name 'soweb-*.db.gz'    -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "[$STAMP] listo:"
du -sh "$BACKUP_DIR"
