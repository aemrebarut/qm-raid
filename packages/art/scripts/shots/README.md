Headless WebGL screenshots (playwright-core with swiftshader, no GPU needed). Not a dependency of the package:
run from a scratch folder that has playwright-core (`mkdir /tmp/art-shot-tool && cd /tmp/art-shot-tool && bun add playwright-core`), then copy these two files there.
- `node shot.mjs <url> <out.png> [w] [h] [waitMs]`: showroom URLs wait until the exhibits are placed; `ART=on` sets the board's art flag.
- `node flow.mjs`: 4619 test board with `?art=on`, orders the first idle unit onto the nearest open target (4618 mock engine), screenshots /tmp/a2-0..2.png.
