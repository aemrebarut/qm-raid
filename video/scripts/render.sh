#!/bin/bash
# Render the Main cut to ~/Workspace/qm-raid-video/<take>/qm-raid-demo.mp4 (H.264 + AAC, 1920x1080).
# Usage: scripts/render.sh <take>   e.g. scripts/render.sh take1
set -euo pipefail
cd "$(dirname "$0")/.."
TAKE="${1:?take name}"
OUT="$HOME/Workspace/qm-raid-video/$TAKE"
mkdir -p "$OUT"
npx remotion render src/index.ts Main "$OUT/qm-raid-demo.mp4" --codec h264 --audio-codec aac --concurrency 8
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height -of compact "$OUT/qm-raid-demo.mp4"
echo "$OUT/qm-raid-demo.mp4"
