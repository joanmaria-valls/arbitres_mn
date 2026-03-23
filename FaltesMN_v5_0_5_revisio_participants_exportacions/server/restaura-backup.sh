#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_FILE="${DATA_PATH:-$ROOT_DIR/data.json}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"

if [ $# -lt 1 ]; then
  echo "Ús: $0 NOM_DEL_BACKUP.json"
  echo "Backups disponibles:"
  ls -1 "$BACKUP_DIR" 2>/dev/null || true
  exit 1
fi

SRC="$1"
if [ ! -f "$SRC" ]; then
  SRC="$BACKUP_DIR/$1"
fi

if [ ! -f "$SRC" ]; then
  echo "No s'ha trobat el backup: $1"
  exit 1
fi

cp "$DATA_FILE" "$DATA_FILE.before-restore.$(date +%Y%m%d-%H%M%S).bak" 2>/dev/null || true
cp "$SRC" "$DATA_FILE"
echo "Restaurat correctament des de: $SRC"
