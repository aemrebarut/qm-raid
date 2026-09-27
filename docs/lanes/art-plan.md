# Team Art plan (raid-art-plan, lead)

Goal: the board looks like a finished Age of Empires style game, with original procedural low-poly assets. `packages/art` is a library of three.js factories with no game logic; raid-ui-scene swaps its placeholders for them one by one behind a flag, so the board never breaks mid-swap.

## Setup
- Run: `cd packages/art && bun run showroom` (127.0.0.1:4620, `GET /health`). `bun run typecheck && bun test test/` before every commit.
- One three: `packages/art/node_modules` is a symlink to `apps/board/node_modules` (`scripts/link.sh`, run by every script). Never `bun install` inside packages/art, never add three as a dependency here. Import `three` and `three/addons/...` only; no imports from apps/, contract/ or services/ (the smoke test checks).
- API shapes: `src/types.ts` (lead owns it, ask before changing). Board imports `packages/art/src/index.ts` (lead adds your export line when your file lands; ping me).
- Showroom exhibits: each implementer owns `showroom/exhibits/<area>.ts`, default-exporting `Exhibit[]` (`{name, area, span?, turntable?, make(ctx) -> {object3d, tick?, actions?, dispose?}}`). A broken exhibit file shows its error in the sidebar and does not break the page. `?area=units`, `?focus=Knight`, `?board=1` (board camera, no turntable). The top bar shows fps, draw calls, triangles.
- Conventions (types.ts header): 1 unit = 1 tile, tile (x, y) centre = world (x + 0.5, 0, y + 0.5); models face +z, rest on y = 0; walkable area flat at y = 0; tick(t, dt) allocation free; dispose() frees own resources; shared geometries and materials cached at module level.
- Board scale: units about 0.8 tall at scale 1 (the board scales them 1.5); buildings fit a 3 x 3 footprint, door on +z; targets within radius 0.35 + 0.1 x severity. Read at board zoom: strong silhouettes, saturated team colour on a large area (tabard, banner), no detail smaller than 0.04.
- Palette: warm late afternoon. Grass #5d7f3a to #7a9a45, dirt #9a7b52, stone #a9a293 / #8a8578, timber #6b4a2b, roof red #9b3b2a, slate #56606b, GBrain blue #3b82d6 / #9fd6ff, remember gold #f0c24a, River blue #2fb8d6, furnace #ff9a3c.
- Owners: units and monsters raid-art-units (`src/units.ts`, `src/monsters.ts`, `exhibits/units.ts`); buildings, terrain, zones, props raid-art-world (`src/world/*`, `exhibits/world.ts`); lighting and effects raid-art-fx (`src/lighting.ts`, `src/fx/*`, `exhibits/fx.ts`); lead: `src/index.ts`, `src/types.ts`, `showroom/main.ts`, `showroom/index.html`, `exhibits/_scale.ts`, this plan, `code/art` devbrain page; reviewer raid-art-rev: `reviews/art.md`, `code/art-review`.
- Flow per step: commit and push your own paths, then `herdr agent prompt raid-art-rev "review <sha>: <line>"`, and tell raid-art-plan when a factory is ready to wire. Devbrain page per area: `code/art-units`, `code/art-world`, `code/art-fx`.

## Integration with the board (raid-ui-scene owns apps/board/src/scene)
The scene keeps everything with game meaning: positions, routing, picking volumes, selection rings, labels, bubbles, progress banners, status to animation mapping. Art supplies the visible body:
- `UnitView` builds `makeUnit({cls, teamColor, forged, typeColor})` into its root, calls `play()` from the unit status (moving -> walk, working -> work, recalling and remembering -> cast, error -> error, idle -> idle, order done -> celebrate), `tick(t, dt)` per frame, `staffTip()` for beams, `onStrike` for sparks. The scene still turns and moves the group.
- `TargetView` builds `makeTarget({kind, severity})`, maps target.status to `setState`, calls `hit()` on strikes and `defeat()` on resolve.
- `buildBuilding` builds `makeBuilding(kind)` (gbrain -> library, river -> forge), uses its `anchor`, `door`, `top` (local, the scene adds the group position), `pulse`, `glow`, `setWork`.
- Terrain and zones: `makeTerrain({size, seed, paths, blocked})`, `makeZone(zoneSpec)`, `makeProps({seed, spots})` in world coordinates; the scene computes paths, gates and blocked tiles as today.
- Lighting: `lighting(scene, renderer, {mapSize: 24})` replaces the scene's hemisphere and sun. Effects: `ArtFx` is a drop-in superset of scene `Fx` (same beam, fly, page, orb, burst, text, sparksAt, after) plus recallBeam, rememberOrb, selectionRing, orderPing, dust, flag, forgeSparks, sparkle.
- Flag: the scene reads `localStorage["raid.art"]` (default on once A2 passes review; `raid.art=off` falls back to placeholders) per area, so each swap can be reverted in one line.

## A1 (15:35): showroom on 4620 with the first hero assets
raid-art-plan
1. Scaffold (package, symlink, types.ts, showroom, scale reference, smoke test). Check: `bun run showroom` serves 4620, `/health` ok, typecheck and test pass. DONE with this commit.
2. Agree the swap with raid-ui-scene (API above, the flag, who wires what). Check: raid-ui-scene confirms.
3. Wire each landed factory into index.ts; run A1 check; TEST.md "A1 art"; devbrain `code/art`; ping the Analyst.
raid-art-units
1. `makeUnit` knight: helmet, shield, staff with gem, team tabard, all six anims. Check: showroom "Knight" plays idle, walk, work, cast, celebrate, error; readable at `?board=1`; setTeamColor switches colour.
2. `makeTarget` bug severity 1..4 (slime to goblin camp) with hit and defeat. Check: four sizes side by side, hit and defeat buttons.
raid-art-world
1. `makeBuilding("library")`: stone monastery, glowing window, GBrain crest, anchor at the orb, pulse, glow. Check: showroom "Library" in a 3 x 3 footprint, pulse button.
2. `makeBuilding("barracks")` and `makeBuilding("forge")` (furnace, anvil, smoke, River-blue glow, setWork). Check: showroom, setWork 0.5 and null.
raid-art-fx
1. `lighting()` rig (ACES, warm sun, soft shadows, hemisphere, light fog) used by the showroom automatically. Check: showroom picks it up (src/lighting.ts exists), 60 fps.
2. `ArtFx` with recallBeam (blue, rising glyph particles) and rememberOrb (gold arc). Check: showroom "Recall beam" and "Remember orb" buttons.
A1 check: showroom shows an animated Knight, the Library, a bug monster and the recall beam; typecheck and smoke test pass; raid-art-rev has reviewed each.

## A2 (15:55): units and buildings in the board
raid-art-units 3. ranger (hood, bow-staff), scout (light cloak), oracle and forged types (glowing runes in typeColor). 4. feature targets (crystal, ruin) 1..4, engaged and resolved looks.
raid-art-world 3. zone walls with towers, gatehouse and banner (`makeZone`).
raid-art-fx 3. selectionRing, orderPing, dust, flag, forgeSparks; ArtFx drop-in parity with scene Fx.
raid-art-plan 4. Swap units, targets and buildings into the board with raid-ui-scene behind the flag. Check on 4619: every fixture unit, target and building is the art version, picking, rings and beams still land, no console errors.

## A3 (16:15): terrain, props, lighting and all effects in the board
raid-art-world 4. `makeTerrain` (height outside the walk area, grass variation, dirt roads, river, instanced trees and rocks) and `makeProps` (fences, crates, farms). Check: showroom "Terrain 24" at 60 fps.
raid-art-fx 4. lighting and ArtFx in the board; workflow handoff effect if the flow lane needs one (docs/lanes/flow.md).
raid-art-units 5. polish from review: silhouettes at board zoom, celebrate on order done.
raid-art-plan 5. Swap terrain, zones, lighting and fx; A3 check on 4619 (recall, remember, spawn, resolve all animate).

## A4 (16:35): polish, performance, screenshots
Everyone: fixes from raid-art-rev. fps counter check on 4619 with 30 units (target 60 fps, at least 45 on a laptop). raid-art-plan: screenshots for the pitch in `docs/shots/` (whole map, Library recall, Forge, a fight), TEST.md A4, final devbrain pages. Freeze 16:40.
