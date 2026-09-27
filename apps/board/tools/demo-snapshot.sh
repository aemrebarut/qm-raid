#!/bin/sh
# Frozen demo board (raid-ui-plan): builds a committed ref (default HEAD, never the working tree) and serves it
# with vite preview on 127.0.0.1:4621, /api proxied to ENGINE_URL (default the real-QM engine 4610).
# Rebuilds, then restarts only the preview this script started (exact PID from /tmp/raid-board-demo/preview.pid).
# Usage: apps/board/tools/demo-snapshot.sh [ref]      Stop: apps/board/tools/demo-snapshot.sh --stop
set -eu
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
PORT=4621
ENGINE_URL=${ENGINE_URL:-http://127.0.0.1:4610}
BASE=/tmp/raid-board-demo
PIDFILE="$BASE/preview.pid"
LOG="$BASE/preview.log"
mkdir -p "$BASE"

stop_ours() {
  [ -f "$PIDFILE" ] || return 0
  OLD=$(cat "$PIDFILE")
  if ps -p "$OLD" -o command= 2>/dev/null | grep -q "vite preview .*--port $PORT"; then
    kill "$OLD"
    i=0; while ps -p "$OLD" >/dev/null 2>&1 && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
    echo "stopped preview pid $OLD"
  fi
  rm -f "$PIDFILE"
}

if [ "${1:-}" = "--stop" ]; then stop_ours; exit 0; fi

REF=${1:-HEAD}
SHA=$(git -C "$REPO" rev-parse --short "$REF")
NEW="$BASE/build-$SHA-$$"
mkdir -p "$NEW"
git -C "$REPO" archive "$REF" apps/board contract packages/art | tar -x -C "$NEW"
ln -s "$REPO/apps/board/node_modules" "$NEW/apps/board/node_modules"
[ -e "$NEW/packages/art/node_modules" ] || ln -s "$REPO/apps/board/node_modules" "$NEW/packages/art/node_modules"
(cd "$NEW/apps/board" && ./node_modules/.bin/vite build --logLevel warn)

stop_ours
cd "$NEW/apps/board"
ENGINE_URL="$ENGINE_URL" nohup ./node_modules/.bin/vite preview --host 127.0.0.1 --port $PORT --strictPort > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
i=0; until curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do
  i=$((i + 1)); if [ $i -gt 50 ]; then echo "preview did not come up, see $LOG"; exit 1; fi; sleep 0.2
done
# Keep only the build being served.
for d in "$BASE"/build-*; do [ "$d" = "$NEW" ] || rm -rf "$d"; done
echo "demo board $SHA on http://127.0.0.1:$PORT (pid $(cat "$PIDFILE"), engine $ENGINE_URL, build $NEW)"
