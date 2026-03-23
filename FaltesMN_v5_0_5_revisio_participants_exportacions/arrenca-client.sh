#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR/client"

if [[ ! -f package.json ]]; then
  echo "No s'ha trobat client/package.json"
  exit 1
fi

if [[ ! -x node_modules/.bin/vite ]]; then
  echo "Instal·lant dependències del client..."
  npm install
fi

if [[ -f "$ROOT_DIR/server/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/server/.env"
  set +a
fi

export VITE_API_BASE="http://127.0.0.1:${PORT:-8787}"

if command -v mkcert >/dev/null 2>&1; then
  echo "Preparant HTTPS local amb la IP actual..."
  bash ./scripts/setup-local-https.sh >/dev/null
  echo "HTTPS local preparat."
else
  echo "ATENCIÓ: 'mkcert' no està instal·lat."
  echo "El client arrencarà en HTTP. Si vols HTTPS local, executa abans:"
  echo "  ./prepara-https-local.sh"
fi

exec npm run dev:raw
