#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOWNLOADS_DIR="${HOME}/Baixades"

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}


stop_old_ports() {
  local had_fuser=0
  if have_cmd fuser; then
    had_fuser=1
    echo "Tancant possibles instàncies anteriors de FaltesMN..."
    fuser -k 8787/tcp >/dev/null 2>&1 || true
    fuser -k 10000/tcp >/dev/null 2>&1 || true
    fuser -k 5173/tcp >/dev/null 2>&1 || true
  fi

  if [[ $had_fuser -eq 0 ]]; then
    echo "Nota: no s'ha trobat 'fuser'. Si algun port queda ocupat, caldrà tancar les terminals antigues manualment."
  fi
}

copy_runtime_env() {
  local source_file=""
  local destination="$ROOT_DIR/server/.env"

  for candidate in \
    "$DOWNLOADS_DIR/faltesmn.env" \
    "$DOWNLOADS_DIR/.env"; do
    if [[ -f "$candidate" ]]; then
      source_file="$candidate"
      break
    fi
  done

  if [[ -n "$source_file" ]]; then
    cp -f "$source_file" "$destination"
    echo "S'ha copiat $(basename "$source_file") a server/.env"
  else
    echo "No s'ha trobat cap fitxer de claus a $DOWNLOADS_DIR (faltesmn.env / .env)."
    echo "Es manté el server/.env existent."
  fi
}

open_term() {
  local title="$1"
  local cmd="$2"

  if have_cmd gnome-terminal; then
    gnome-terminal --title="$title" -- bash -lc "$cmd; exec bash"
  elif have_cmd xfce4-terminal; then
    xfce4-terminal --title="$title" --command="bash -lc '$cmd; exec bash'"
  elif have_cmd konsole; then
    konsole --new-tab -p tabtitle="$title" -e bash -lc "$cmd; exec bash" >/dev/null 2>&1 &
  elif have_cmd mate-terminal; then
    mate-terminal --title="$title" -- bash -lc "$cmd; exec bash"
  elif have_cmd tilix; then
    tilix --title="$title" -e "bash -lc '$cmd; exec bash'" >/dev/null 2>&1 &
  elif have_cmd lxterminal; then
    lxterminal -t "$title" -e "bash -lc '$cmd; exec bash'" >/dev/null 2>&1 &
  elif have_cmd x-terminal-emulator; then
    x-terminal-emulator -T "$title" -e bash -lc "$cmd; exec bash" >/dev/null 2>&1 &
  elif have_cmd xterm; then
    xterm -T "$title" -e bash -lc "$cmd; exec bash" >/dev/null 2>&1 &
  else
    echo "No he trobat cap emulador de terminal gràfic compatible."
    echo "Executa manualment, en dues terminals diferents:"
    echo "  ./arrenca-server.sh"
    echo "  ./arrenca-client.sh"
    exit 1
  fi
}

copy_runtime_env
stop_old_ports

SERVER_CMD="cd \"$ROOT_DIR\" && ./arrenca-server.sh"
if have_cmd mkcert; then
  CLIENT_CMD="cd \"$ROOT_DIR\" && ./arrenca-client.sh"
else
  CLIENT_CMD="cd \"$ROOT_DIR\" && ./prepara-https-local.sh && ./arrenca-client.sh"
fi

open_term "FaltesMN - Servidor" "$SERVER_CMD"
sleep 1
open_term "FaltesMN - Client" "$CLIENT_CMD"

echo "S'han obert dues terminals: servidor i client."
