#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/server"

if [[ ! -f package.json ]]; then
  echo "No s'ha trobat server/package.json"
  exit 1
fi

if [[ ! -x node_modules/.bin || ! -f node_modules/dotenv/package.json ]]; then
  echo "Instal·lant dependències del servidor..."
  npm install
fi

exec npm run dev
