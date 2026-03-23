# FaltesMN (CAT) – client web

## Engegar

```bash
npm install
```

### Opció 1: desenvolupament normal

```bash
npm run dev
```

### Opció 2: HTTPS local per a proves amb mòbil o tauleta

Primer crea el certificat local:

```bash
sudo apt update
sudo apt install -y mkcert libnss3-tools
mkcert -install
npm run setup:https
```

Després arrenca com sempre:

```bash
npm run dev
```

Si existeixen els fitxers `certs/dev-cert.pem` i `certs/dev-key.pem`, Vite arrencarà automàticament en HTTPS local.

## Quan canvies de xarxa

- `https://localhost:5173/` continua anant bé al mateix portàtil.
- Si la IP local canvia i vols entrar-hi des d'un altre dispositiu, torna a executar `npm run setup:https`.

## Notes

- En desenvolupament, la PWA no registra service worker per evitar problemes de caché entre versions.
- El client valida les sessions guardades abans d'obrir un perfil.
- Si una sessió antiga ja no és vàlida, la web la neteja automàticament i torna a la portada.
- El certificat arrel que has d'instal·lar al mòbil és `rootCA.pem`, que trobaràs amb `mkcert -CAROOT`.
- No comparteixis mai `rootCA-key.pem`.


## HTTPS local automàtic

- Si `mkcert` ja està instal·lat, `./arrenca-client.sh` regenera automàticament el certificat amb la IP actual i arrenca el client en HTTPS.
- Si `mkcert` no hi és, el client arrenca igualment en HTTP i et mostra el missatge amb l'ordre a executar una sola vegada: `./prepara-https-local.sh`.
