#!/usr/bin/env bash
set -euo pipefail
if command -v fuser >/dev/null 2>&1; then
  echo "Tancant FaltesMN si estava obert..."
  fuser -k 8787/tcp >/dev/null 2>&1 || true
  fuser -k 5173/tcp >/dev/null 2>&1 || true
  echo "Ports 8787 i 5173 alliberats."
else
  echo "No s'ha trobat 'fuser'. Tanca manualment les terminals antigues de servidor i client."
fi
