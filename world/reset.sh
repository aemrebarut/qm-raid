#!/bin/sh
# Reset the game brain to the demo world (the brain service must be running; it owns the DB).
curl -sf -X POST "${BRAIN_URL:-http://127.0.0.1:4616}/reset" || { echo "brain service not reachable" >&2; exit 1; }
echo
