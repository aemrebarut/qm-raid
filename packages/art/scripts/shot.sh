#!/bin/sh
# Headless screenshot of a page with WebGL: scripts/shot.sh <url> <out.png> [width] [height] [wait ms]
# Example: sh scripts/shot.sh "http://127.0.0.1:4620/?focus=Knight&board=1" /tmp/knight.png
URL="$1"; OUT="$2"; W="${3:-1440}"; H="${4:-900}"; WAIT="${5:-6000}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d /tmp/art-shot.XXXXXX)"
"$CHROME" --headless=new --disable-gpu-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader \
  --user-data-dir="$PROFILE" --hide-scrollbars --window-size="$W,$H" \
  --virtual-time-budget="$WAIT" --screenshot="$OUT" "$URL" >/dev/null 2>&1
rm -rf "$PROFILE"
[ -s "$OUT" ] && echo "$OUT" || { echo "shot failed" >&2; exit 1; }
