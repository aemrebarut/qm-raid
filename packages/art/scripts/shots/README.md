Headless WebGL screenshots and perf probes (playwright-core with swiftshader, no GPU needed). playwright-core is not a
dependency of the package, so the scripts run from a scratch folder: `sh packages/art/scripts/shots/setup.sh` creates
/tmp/art-shot-tool (playwright-core plus copies of these scripts). Then from /tmp/art-shot-tool:
- `node shot.mjs <url> <out.png> [w] [h] [waitMs]`: showroom URLs wait until the exhibits are placed; `ART=on` sets the board's art flag.
- `node flow.mjs`: 4619 test board with `?art=on`, orders the first idle unit onto the nearest open target (4618 mock engine), screenshots /tmp/a2-0..2.png.
- `node pitch.mjs [outDir]`: pitch screenshots into docs/shots (whole map with and without HUD, Library recall, a fight at a camp, the Forge), orders go to the 4618 mock only.
- `node perf.mjs off on`: draw calls, triangles, programs, geometries, textures on 4619 per art mode (reads window.raidScene.renderer.info).
