#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CERT_DIR="$CLIENT_DIR/certs"
CERT_FILE="$CERT_DIR/dev-cert.pem"
KEY_FILE="$CERT_DIR/dev-key.pem"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "ERROR: no s'ha trobat 'mkcert'."
  echo "Instal·la'l primer amb aquestes ordres:"
  echo "  sudo apt update"
  echo "  sudo apt install -y mkcert libnss3-tools"
  echo "  mkcert -install"
  exit 1
fi

mkdir -p "$CERT_DIR"

HOSTNAME_SHORT="$(hostname 2>/dev/null || true)"
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || true)"
IPS_RAW="$(hostname -I 2>/dev/null || true)"

names=(localhost 127.0.0.1 ::1)

if [[ -n "$HOSTNAME_SHORT" ]]; then
  names+=("$HOSTNAME_SHORT")
  names+=("$HOSTNAME_SHORT.local")
fi

if [[ -n "$HOSTNAME_FQDN" && "$HOSTNAME_FQDN" != "$HOSTNAME_SHORT" ]]; then
  names+=("$HOSTNAME_FQDN")
fi

for ip in $IPS_RAW; do
  if [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    names+=("$ip")
  fi
done

unique_names=()
for item in "${names[@]}"; do
  skip=0
  for existing in "${unique_names[@]:-}"; do
    if [[ "$existing" == "$item" ]]; then
      skip=1
      break
    fi
  done
  if [[ $skip -eq 0 ]]; then
    unique_names+=("$item")
  fi
done

echo "Generant certificat local per a aquests noms/IPs:"
printf ' - %s\n' "${unique_names[@]}"

mkcert -cert-file "$CERT_FILE" -key-file "$KEY_FILE" "${unique_names[@]}"

echo
echo "CERTIFICAT CREAT:"
echo "  $CERT_FILE"
echo "  $KEY_FILE"
echo
echo "Ara ja pots arrencar el client amb:"
echo "  npm run dev"
echo
echo "IMPORTANT per a iPhone/iPad o Android:"
echo "  1) Executa: mkcert -CAROOT"
echo "  2) Copia al mòbil el fitxer rootCA.pem d'aquella carpeta"
echo "  3) Instal·la'l i marca'l com a certificat de confiança"
