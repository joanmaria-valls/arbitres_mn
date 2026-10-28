# Cloudflare Tunnel i FaltesMN

## Abast

Cloudflare Tunnel publica un servei que ja està en marxa. No instal·la FaltesMN,
no serveix per si mateix els fitxers del client i no canvia la persistència JSON.

Seguiu primer [SETUP.md](SETUP.md), especialment la configuració explícita
de `PORT=8787` i les comprovacions locals.

## Servei que cal publicar

La URL pública ha de donar accés a:

- La interfície del client.
- `/api`, reenviat al servidor Node.
- `/ws`, reenviat al servidor Node amb suport de WebSocket.

Publicar només el port 8787 no publica la interfície: Express no serveix
`client/dist/`. En un desplegament permanent, apunteu el túnel al servidor web
que serveix el client compilat i reenvia les dues rutes al servidor Node.

El servidor de desenvolupament de Vite ja conté aquests proxys, però no és
el procediment de desplegament permanent. El seu ús amb un túnel requereix revisar
HTTPS local, el certificat i l'acceptació del nom de host; aquesta guia no
certifica aquesta combinació.

## Configuració d'un túnel amb domini

Cal tenir `cloudflared` instal·lat, un compte de Cloudflare i el domini configurat
per al túnel. La instal·lació depèn del sistema: no pressuposeu que
`apt install cloudflared` funciona sense configurar el repositori corresponent.

Per a un túnel gestionat localment, cal autenticar-se, crear el túnel, configurar
les credencials i l'encaminament DNS del nom públic, i executar-lo.
La guia anterior ometia el pas DNS.

Exemple orientatiu d'`ingress` dins de la configuració de `cloudflared`:

```yaml
tunnel: IDENTIFICADOR_DEL_TUNEL
credentials-file: /ruta/absoluta/credencials.json
ingress:
  - hostname: faltes.exemple.cat
    service: http://127.0.0.1:8080
  - service: http_status:404
```

El port 8080 és només un exemple: ha de ser el del servidor web local que serveix
el client i reenvia `/api` i `/ws`. El domini, l'identificador i el camí de
credencials també s'han de substituir. Aquesta configuració no crea el registre DNS.

No traslladeu directament aquesta configuració a un túnel gestionat des del
tauler de Cloudflare: utilitzeu el procediment del tipus de túnel escollit.

## Validació abans d'utilitzar-lo

1. Confirmeu que el servei local funciona sense el túnel.
2. Accediu al domini públic amb HTTPS i comproveu que es carrega el client.
3. Comproveu `/api/health` a través del mateix domini.
4. Proveu l'entrada de l'Àrbitre Principal, l'Àrbitre Auxiliar de Recorregut
   i l'Àrbitre Auxiliar de Taula amb una competició de prova.
5. Confirmeu la connexió WebSocket i la sincronització entre dos dispositius.
6. Genereu els enllaços i QR amb la URL pública HTTPS i comproveu-los des d'un mòbil.

La instal·lació de `cloudflared`, el DNS i la connexió real al compte s'han de
validar a l'entorn de destinació. Aquesta revisió és documental i no ha creat
ni modificat cap túnel.
