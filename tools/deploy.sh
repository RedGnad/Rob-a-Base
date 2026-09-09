#!/bin/sh
# Deploys the World, and refuses to ship a development bundle.
#
# `sdk-commands start` rewrites bin/index.js as a dev build (unminified, with a 6 MB inline
# sourcemap); a `deploy --skip-build` run after a preview shipped exactly that, and the
# handset spent its whole loading screen on it (28 Aug). This builds production first and
# checks the artefact before anything leaves the machine.
set -e
cd "$(dirname "$0")/.."
# Stamp the build with the commit it came from, so the running client can say which
# version it is and nobody has to guess whether a change shipped or the cache is stale.
HASH=$(git rev-parse --short=4 HEAD 2>/dev/null || echo '????')
printf '/**\n * Which build you are looking at, written by tools/deploy.sh before every build.\n *\n * The world pointer is cached for minutes after an upload and the launcher refocuses a\n * running Explorer instead of restarting it, so "nothing has changed" is ambiguous by\n * construction: the code may be wrong, or the client may simply be showing the previous\n * version. Two hours of that argument (1 Sep) is what this four-character string ends.\n */\nexport const BUILD = %s%s%s\n' "'" "$HASH" "'" > src/client/build-stamp.ts
npm run build:prod
SIZE=$(stat -f %z bin/index.js)
if grep -q 'sourceMappingURL=data' bin/index.js || [ "$SIZE" -gt 3000000 ]; then
  echo "REFUSED: bin/index.js is a development bundle ($SIZE B)"; exit 1
fi
echo "bundle: $SIZE B, production"
# The signing window is 300 s from the moment the linker opens (the content server refuses a
# signature older than that). An unsigned linker used to stay up for ever, holding its port and
# piling up: six of them on one night (5 to 6 Sep), each stealing the next deploy's port and
# the wallet's reconnection with it. So the linker is given 330 s and then closed by this
# script itself; the port comes back and the next attempt reuses it.
npx sdk-commands deploy --target-content https://worlds-content-server.decentraland.org --no-browser --skip-version-checks --skip-build "$@" &
LINKER=$!
# A wall-clock deadline, not one long sleep: on 10 Sep a single `sleep 330` returned after 50 s
# under the agent's shell and the linker was closed before anyone could sign. The loop re-checks
# the clock every 5 s, so a shortened sleep only shortens a step, never the window.
( START=$(date +%s); while [ $(( $(date +%s) - START )) -lt 330 ]; do sleep 5; done
  if kill -0 "$LINKER" 2>/dev/null; then echo "signing window over ($(( $(date +%s) - START )) s): closing the linker"; kill "$LINKER" 2>/dev/null; fi ) &
TIMER=$!
wait "$LINKER"
CODE=$?
kill "$TIMER" 2>/dev/null
exit $CODE
