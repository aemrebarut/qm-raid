# Art review log

Owner: raid-art-rev. Implementation stays with raid-art-plan, raid-art-units,
raid-art-world, raid-art-fx and raid-ui-scene.

## 2026-09-27 15:14 PDT: first review and visual baseline

Scope: read docs/COMMON.md, docs/CONTRACT.md, docs/lanes/art.md,
docs/lanes/ui.md, code/board and code/board-scene in devbrain, and all scene
modules in apps/board/src/scene/. Baseline scene commit: 7e1e713. The shared
main branch continued changing during this review; this is not an A1 signoff.

Evidence:

- GET http://127.0.0.1:4619/health returned `{"ok":true,"service":"board"}`.
- Visually inspected the same test board through http://localhost:4619 in
  Chrome at 15:13. The 127.0.0.1 browser navigation remained pending although
  HTTP reads worked; the loopback alias rendered immediately. Cause not proven.
- Board displayed mock backend, six units, three building types, four walled
  districts, severity-coloured monsters/crystals, and a Library-to-unit beam.
  No review commands were submitted to the engine.
- `cd apps/board && bun test test/`: 8 passed, 0 failed, 44 assertions.
- `bun run typecheck`: failed in core/fixture.ts:41-42 (Team.workflow missing)
  and core/store.ts:33 (State.workflowRuns missing) after the workflow contract
  addition. Sent to raid-ui-plan; this is an existing UI integration gap,
  not an art-package defect. Browser console and FPS were not measured.
- packages/art was not yet present at the initial inspection. Asset commit
  reviews and showroom smoke are pending the scaffold.

### Concrete findings

1. **P2, unit visibility: trees obscure the idle-unit staging area.** At the
   default view, trees immediately south of the Library overlap several idle
   unit bodies. terrain.ts blockedTiles reserves zones, building footprints
   and targets, but has no staging/spawn-area exclusions. Sent to
   raid-art-world and raid-ui-scene. Reserve these areas when placing props,
   keeping the staff, torso and team tabard visible. Acceptance: all initial
   units are visually identifiable without panning away or selecting them.
2. **P2, initial composition: Barracks hidden by the HUD.** At the observed
   initial browser viewport, most of the Barracks lies behind the bottom HUD;
   the north Billing district is also clipped. camera.ts fitMap considers
   width and the full canvas, not a HUD-safe rectangle or building height.
   Sent to raid-ui-scene. Fit the projected map and important buildings within
   the usable view. Acceptance: Library, Forge and Barracks are recognizable
   on initial load without a pan, with units large enough to distinguish.

The baseline has readable building roof silhouettes, distinct monster and
crystal shapes, coloured district flags, soft-edged shadows, and a visible
recall effect. Preserve these during the factory swap.

### A1 gate, due 15:35 PDT

- Showroom starts at 127.0.0.1:4620, loads without a runtime/import failure,
  and exposes one animated hero, Library, monster and recall beam.
- Hero idle/walk/work/cast/celebrate states visibly differ; play and update
  calls do not accumulate transforms or displace the owning board wrapper.
- Staff tip follows the cast pose. Blue recall travels from Library to unit;
  gold remember travels into the Library and triggers its pulse on arrival.
- Check silhouettes at the board's orthographic angle and map scale, not only
  the showroom turntable. Team cloth remains visible; class detail must not
  disappear into tree silhouettes or the ground.
- Factories remain original procedural Three.js assets with no board imports,
  network/game logic, downloaded models, copied art or credentials.
- Construction/update/disposal smoke covers exported factories. Disposing one
  asset must not damage another asset sharing geometry/materials. Effects end
  and release their objects. Record particle/draw-call counts when available;
  do not claim 60 fps from an idle or hidden browser tab.

### Integration checks for A2 and later

- Keep board ownership of position, routing, selection, picking, state and
  events. Tile (x, y) maps to world (x + 0.5, height, y + 0.5).
- Preserve staff-tip, Library orb, building door and chimney anchors. Convert
  local anchors through parent transforms before starting world-space FX.
- Honour the agreed per-factory feature flag and retain runnable fallbacks.
  Match the existing building footprint or explicitly coordinate changes with
  routing, spawn points, ring radius and pick volumes.
- Recheck team tint updates, forged types, resolved flags, hit/defeat state,
  selection rings, moving beam endpoints and Library/Forge pulses.
- A2 15:55: units/buildings integrated and mock order/recall/remember smoke.
  A3 16:15: terrain/props/lighting/effects and clear movement corridors.
  A4 16:35: foreground FPS, cleanup under repeated effects, pitch screenshots.
  Freeze 16:40. Every received commit gets git-show review, relevant smoke,
  an appended outcome here, and concrete findings sent to its owner.
