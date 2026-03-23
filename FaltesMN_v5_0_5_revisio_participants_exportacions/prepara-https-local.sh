#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "No s'ha trobat 'sudo'. Instal·la mkcert manualment i després executa: mkcert -install"
  exit 1
fi

echo "Instal·lant mkcert i eines necessàries..."
sudo apt update
sudo apt install -y mkcert libnss3-tools

echo
echo "Instal·lant el certificat arrel local de mkcert..."
mkcert -install

echo
echo "Ja està preparat. Ara ja pots executar:"
echo "  ./arrenca-client.sh"
