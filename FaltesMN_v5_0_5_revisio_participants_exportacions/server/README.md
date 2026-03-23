# FaltesMN – servidor (base v5.0.0)

Servidor HTTP + WebSocket per compartir en temps real les faltes entre àrbitres i taula.

## Requisits
- Node.js 18+ (recomanat 20+)

## Configuració
Crea un fitxer `.env` (al costat d'`index.mjs`) amb:

```
PLATFORM_ADMIN_KEY=posa_una_clau_llarga_i_secreta
PORT=8787
# opcional
# DATA_PATH=/ruta/a/data.json
```

## Engegar

```
npm install
npm run dev
```

## Crear claus d'Àrbitre Principal (Principal)

Crida l'endpoint d'admin:

- `POST /api/admin/principals`
  - header: `x-admin-key: <PLATFORM_ADMIN_KEY>`
  - body: `{ "name": "Nom del principal" }`

Resposta: retorna `principalKey` (la clau que li donaràs al principal). Guarda-la bé.

> A la PWA hi haurà una pantalla d'admin perquè ho puguis fer sense utilitzar Postman/curl.

