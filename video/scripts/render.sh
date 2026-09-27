#!/bin/bash
# Render the Main cut to ~/Workspace/qm-raid-video/<take>/qm-raid-demo.mp4 (H.264 + AAC, 1920x1080).
# Usage: scripts/render.sh <take> [--real] [--warden]   e.g. scripts/render.sh final --real
set -euo pipefail
cd "$(dirname "$0")/.."
TAKE="${1:?take name}"; shift  # remaining args go to the planner, e.g. --real --warden
OUT="$HOME/Workspace/qm-raid-video/$TAKE"
mkdir -p "$OUT"
# Preflight: every audio file the manifest names must exist (Remotion copies public/ at bundle time).
python3 - <<'PY'
import json, os, sys
m = json.load(open("audio/manifest.json"))
files = [t["file"] for t in m.get("tracks", []) + m.get("alts", []) + m.get("sfx", [])] + ([m["music"]["file"]] if m.get("music") else [])
missing = sorted({f for f in files if not os.path.exists(os.path.join("audio", f))})
if missing: sys.exit("missing audio: " + ", ".join(missing))
print("audio ok:", len(set(files)), "files")
PY
bun scripts/plan.ts "$@"
npx remotion render src/index.ts Main "$OUT/qm-raid-demo.mp4" --codec h264 --audio-codec aac --concurrency 8
npx remotion still src/index.ts Main "$OUT/thumbnail.png" --frame=0
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "$OUT/qm-raid-demo.mp4"
echo "$OUT/qm-raid-demo.mp4"
