# FaltesMN: instal·lació i desplegament

## Estructura real

L'aplicació es troba a `FaltesMN_v5_0_5_revisio_participants_exportacions/`:

- `client/`: interfície React i TypeScript, amb Vite i configuració PWA.
- `server/`: API Express i WebSocket a `/ws`.
- `server/lib/store.mjs`: persistència en JSON, còpies de seguretat i registre d'operacions.

El directori `server/` de l'arrel del repositori és diferent: conté un
`.env.example` amb variables MySQL i un mòdul SQLite (`lib/db.mjs`).
L'entrada del servidor de l'aplicació no importa aquest mòdul i el seu
`package.json` no declara `sqlite` ni `sqlite3`. Aquests fitxers no constitueixen
una migració integrada. No els utilitzeu per configurar aquesta versió.

No hi ha cap `package.json` a l'arrel: no hi executeu `npm install` ni `npm start`.

## Requisits

- Git, Node.js i npm.
- Per al conjunt client/servidor, feu servir Node.js 22.12 o superior dins
  de la branca 22. El lockfile del client exigeix, mitjançant
  `@vitejs/plugin-react`, `^20.19.0 || >=22.12.0`; Node 14 i 18 no són adequats.
- Bash per als scripts `.sh` (a Windows, cal un entorn compatible com WSL).
- `mkcert` és opcional per preparar HTTPS local.

Aquest requisit de Node es deriva de les dependències del repositori; aquesta
revisió documental no certifica una instal·lació en un ordinador concret.

## Instal·lació

```bash
git clone https://github.com/joanmaria-valls/arbitres_mn.git
cd arbitres_mn/FaltesMN_v5_0_5_revisio_participants_exportacions
(cd server && npm ci)
(cd client && npm ci)
```

Creeu `server/.env`, al costat d'`index.mjs`, amb:

```dotenv
PLATFORM_ADMIN_KEY=substituiu_aquest_text_per_una_clau_llarga_i_secreta
PORT=8787
# Opcional: rutes absolutes en un volum persistent
# DATA_PATH=/ruta/persistent/data.json
# BACKUP_DIR=/ruta/persistent/backups
# LOG_DIR=/ruta/persistent/logs
```

No publiqueu la clau ni el fitxer `.env`. No copieu el `.env.example` del
`server/` de l'arrel: les seves variables MySQL no configuren aquest servidor.

**Configureu explícitament `PORT=8787`.** Sense aquesta variable,
`server/index.mjs` utilitza 10000, mentre que el proxy del client i el seu
script d'arrencada assumeixen 8787.

## Arrencada local

Des de la carpeta de l'aplicació, en una terminal:

```bash
cd server
npm start
```

En una segona terminal, també des de la carpeta de l'aplicació:

```bash
cd client
npm run dev
```

El client utilitza el port 5173 i reenvia `/api` i `/ws` al servidor.
Seguiu l'adreça que mostra Vite. L'script del client prepara HTTPS si troba
`mkcert`; sense certificats, Vite serveix HTTP. L'accés des de mòbils amb
funcions que requereixen un context segur necessita HTTPS i confiança en el certificat.

Comprovació del servidor des d'una altra terminal:

```bash
curl http://127.0.0.1:8787/api/health
```

La resposta ha d'incloure `"ok":true`. Comproveu també l'accés des del client
i la sincronització entre dos navegadors amb una competició de prova.

Si canvieu el port del servidor, adapteu també el destí del proxy. El llançador
`arrenca-client.sh` llegeix `PORT` de `server/.env` i exporta `VITE_API_BASE`.
Aquest fitxer és carregat amb `source`: manteniu-hi sintaxi compatible amb Bash.
`VITE_API_BASE` configura el proxy de Vite; les peticions del navegador són relatives.

## Dades i còpies

Sense rutes personalitzades, el servidor utilitza `data.json` del directori
de treball; amb les ordres anteriors és `server/data.json`.
Els directoris `backups/` i `logs/` es creen al costat de les dades.

- `BACKUP_INTERVAL_MS`: interval mínim entre còpies durant els desaments,
  per defecte 300000 ms, amb un mínim de 60000 ms.
- `MAX_BACKUPS`: nombre de còpies conservades, per defecte 36, mínim 5.
- Hi ha còpies forçades en arrencar i en rebre SIGINT/SIGTERM.
- No és un temporitzador independent que generi còpies cada cinc minuts sense activitat.

Conserveu dades, còpies i registres en un volum persistent i feu també còpies
fora de l'ordinador. No sobreescriviu les dades existents en actualitzar el codi.
El repositori ja conté un `server/data.json`: no el pressuposeu buit ni adequat
per iniciar una instal·lació nova.

La restauració recupera el fitxer global, que pot contenir diverses competicions.
Abans de restaurar, conserveu una còpia de l'estat actual. Si feu servir
`restaura-backup.sh`, atureu abans el servidor; l'script no carrega `.env`
i necessita les variables de ruta exportades si heu personalitzat les ubicacions.

## Desplegament permanent

`npm run dev` és per a desenvolupament. Per preparar el client:

```bash
cd client
npm run build
```

Serviu `client/dist/` amb un servidor web HTTPS. Configureu el mateix origen públic
per servir els fitxers del client i reenviar `/api` i `/ws` al servidor Node;
el segon necessita suport de WebSocket. El servidor Express actual no serveix
automàticament `client/dist/`. `vite preview` no substitueix aquesta configuració.

Manteniu el procés Node amb un gestor de serveis, el directori de treball correcte,
les variables d'entorn carregades i emmagatzematge persistent. El servidor escolta
a `0.0.0.0`; limiteu l'accés directe al port segons l'entorn.
La configuració concreta del servei i del servidor web s'ha de validar al sistema
de destinació abans d'utilitzar-lo en una prova.

Per a Cloudflare Tunnel, consulteu [CLOUDFLARE.md](CLOUDFLARE.md).
Un túnel no substitueix ni el servidor Node ni el servei dels fitxers del client.

## Comprovacions disponibles

El client ofereix `npm run build` i `npm run lint`.
Cap dels dos `package.json` de l'aplicació defineix `npm test`.
Aquesta guia no afirma que la compilació, el lint o el desplegament s'hagin executat
satisfactòriament: cal comprovar-los a l'entorn de destinació.

## Documentació que pot induir a errors

- `server/.env.example` i `server/lib/db.mjs` de l'arrel: no integrats en
  l'aplicació d'aquesta carpeta.
- `client/README.md`: plantilla general de React/Vite, no guia de desplegament.
- `server/README.md`: la menció a Node 18 no cobreix els requisits del client.
- El port per defecte del codi del servidor (10000) difereix del proxy (8787).
- L'antiga guia incloïa MySQL, `npm test` i `example.com/docs` sense correspondència
  amb aquesta aplicació; no s'han de seguir aquestes instruccions.
