#!/bin/sh
# Bootstrap the headless screenshot tools outside the repo (playwright-core is not a package dependency):
#   sh packages/art/scripts/shots/setup.sh  ->  /tmp/art-shot-tool with playwright-core and these scripts
# Then: cd /tmp/art-shot-tool && node shot.mjs <url> <out.png> | node flow.mjs | node perf.mjs off on
set -e
DIR=/tmp/art-shot-tool
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"
[ -d "$DIR/node_modules/playwright-core" ] || (cd "$DIR" && bun add playwright-core@1.63.0 >/dev/null)
cp "$HERE"/*.mjs "$DIR"/
echo "$DIR ready (uses the cached Playwright chromium under ~/Library/Caches/ms-playwright)"
