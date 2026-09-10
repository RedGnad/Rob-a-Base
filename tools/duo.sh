#!/usr/bin/env bash
# Deux fenetres, deux joueurs, un seul serveur. Une commande.
#
# Chaque piege qu'on a traverse le 24 Aug est traite ici, et aucun ne se voit a l'oeil nu:
#   - un apercu deja lance fait glisser le nouveau sur le port suivant, EN SILENCE, et les
#     deux fenetres se retrouvent alors dans deux mondes differents;
#   - `open` ne lance PAS une seconde instance sur macOS, il reactive celle qui tourne:
#     il faut `open -n`;
#   - les deux explorateurs se disputent le port MCP: la seconde fenetre meurt sur
#     `SocketException: Address already in use`, avant meme l'ecran de connexion;
#   - un serveur multijoueur relance pendant que des clients restent connectes leur laisse
#     un instantane perime: on repart donc toujours de zero.
set -u
PORT=8000
APP="$HOME/Library/Application Support/DecentralandLauncherLight/latest/Decentraland.app"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"

RESET=0
[ "${1:-}" = "--reset" ] && RESET=1

echo "==> on arrete tout ce qui traine"
pkill -9 -f "MacOS/Explorer"  2>/dev/null
pkill -9 -f "hammurabi"       2>/dev/null
pkill -9 -f "friendzone/node_modules/typescript" 2>/dev/null
for p in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ":80[0-9][0-9]" | awk '{print $2}' | sort -u); do
  kill -9 "$p" 2>/dev/null
done
sleep 4

if [ "$RESET" = "1" ]; then
  # Le stockage ne peut etre vide qu'une fois le serveur ARRETE: sinon il reecrit sa
  # memoire par-dessus et la remise a zero n'a servi a rien.
  echo "==> remise a zero du stockage"
  echo '{}' > node_modules/@dcl/sdk-commands/.runtime-data/server-storage.json
  rm -f main.crdt main1.crdt
fi

if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ECHEC: le port $PORT est encore pris. Rien n'est lance."
  echo "       Ferme l'apercu du Creator Hub, puis relance."
  exit 1
fi

echo "==> apercu unique sur $PORT"
nohup npm run start -- --explorer-alpha --hub --landscape-terrain-enabled --multi-instance --mcp \
  > /tmp/preview.log 2>&1 &

echo -n "    attente du realm"
for i in $(seq 1 60); do
  n=$(curl -s --max-time 2 "http://127.0.0.1:$PORT/about" \
      | python3 -c "import sys,json;print(len(json.load(sys.stdin)['configurations']['localSceneParcels']))" 2>/dev/null)
  if [ -n "${n:-}" ]; then echo " pret, $n parcelles"; break; fi
  echo -n "."; sleep 2
done
[ -z "${n:-}" ] && { echo " ECHEC: le realm ne repond pas"; exit 1; }

if lsof -nP -iTCP:8001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ECHEC: un second realm ecoute sur 8001. Les fenetres seraient dans deux mondes."
  exit 1
fi

echo "==> fenetre 1 (celle qui porte MCP), ouverte par l'apercu"
echo -n "    attente du chargement"
for i in $(seq 1 45); do
  grep -q "\[SERVER\]" /tmp/preview.log 2>/dev/null && { echo " serveur pret"; break; }
  echo -n "."; sleep 2
done
sleep 20

echo "==> fenetre 2, sans MCP, nouvelle instance forcee"
LIEN="decentraland://realm=http%3A%2F%2F127.0.0.1%3A$PORT&position=0%2C0&dclenv=org&local-scene=true&hub=true&multi-instance=true&open-deeplink-in-new-instance=true"
open -n "$APP" --args "$LIEN"
sleep 25

echo
echo "==> etat"
echo "    explorateurs : $(ps aux | grep -c '[M]acOS/Explorer')"
echo "    realms       : $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -cE ':80[0-9][0-9]')  (doit valoir 1)"
echo "    comms perdues: $(grep -ci disposed /tmp/preview.log 2>/dev/null)  (doit valoir 0)"
echo
echo "    Connecte-toi avec un compte DIFFERENT dans chaque fenetre."
echo "    Journal serveur en direct :  tail -f /tmp/preview.log"
