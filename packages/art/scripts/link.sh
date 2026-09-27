#!/bin/sh
# One copy of three for the showroom and the board: packages/art/node_modules is a symlink to
# apps/board/node_modules, so vite and tsc resolve `three` to the same real path in both apps
# (two copies would break instanceof checks and duplicate the types).
cd "$(dirname "$0")/.." || exit 1
if [ ! -e ../../apps/board/node_modules/three ]; then
  (cd ../../apps/board && bun install) || exit 1
fi
[ -e node_modules ] || ln -s ../../apps/board/node_modules node_modules
