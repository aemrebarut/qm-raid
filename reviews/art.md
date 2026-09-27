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

## 2026-09-27 15:18 PDT: scaffold 88331b8

Reviewed `git show 88331b8` (13 files, 549 insertions): types, showroom,
single-Three link script, import smoke, package configuration and art plan.
Ran the requested checks in the shared working tree, which already included
untracked in-progress units, lighting and world files:

- `bun run typecheck`: pass.
- `bun test test/`: 1 passed, 0 failed, 20 assertions.
- Existing server `GET /health`: `{"ok":true,"service":"art"}`.
- realpath of packages/art/node_modules/three and apps/board/node_modules/three
  is identical. No second server was started and no implementation was edited.
- Chrome at `http://127.0.0.1:4620/?board=1`: sidebar and Scale reference row
  appear, but canvas stays blank and FPS text never appears. DevTools shows
  repeated `TypeError: rig?.update is not a function` at showroom/main.ts:192.

**P1, live A1 blocker: lighting handle mismatch aborts every render.**
types.ts defines Lighting.update(), but the in-progress src/lighting.ts exports
a separately declared LightingRig with follow/setWarmth/dispose and no update.
The showroom glob is type-asserted as returning Lighting, so typechecking
does not detect the mismatch. main.ts:192 calls update before renderer.render.
This is a live integration failure exposed during scaffold review, not a
claim that the missing lighting implementation was part of 88331b8.

Sent to raid-art-plan and raid-art-fx: implement/typecheck the agreed handle
and validate or isolate optional lighting so a malformed rig cannot suppress
all exhibits. Retest the actual browser: reference mesh visible, FPS/draw text
updates, and no repeated update error. Health and import smoke alone are not
render acceptance. A1 visual signoff is pending this fix and the hero assets.

code/art was not yet published when queried at 15:16; lead owns that page.

## 2026-09-27 15:30 PDT: asset reviews and fixes

Read the diffs for `017bf0c`, `fd42123`, `727f7da`, `b6a2573`,
`c7e4c30`, `9b0cac8`, `65f5f87` and `8d7e511`. Tests run in the shared
working tree, which continued advancing during review. No implementation
files changed by reviewer. Temporary structural diagnostics use a no-op
canvas context, so their results do not establish texture or GPU correctness.

### World: 017bf0c, b6a2573, 9b0cac8

- **Closed P1: inverted roof slope.** In 017bf0c slabRoof rotated the left
  half by -ang, putting eaves above the ridge. b6a2573 uses +ang. Numeric
  check for slabRoof(1.42, 2.04, .8): ridge .807 to .853, eaves -.053 to
  -.007, consistent with the intended roof thickness and orientation.
- **Closed P2: Barracks glow overwritten by tick.** b6a2573 persists the
  requested lit state; tick now retains emissive intensity 1.6 when lit.
- **Closed P2: terrain disposal crossed instance ownership.** b6a2573 used
  a module-global tree geometry list and omitted leaf-material disposal.
  Creating A and B then disposing A disposed eight live B geometries.
  9b0cac8 returns each forest's geometry/material lists; the same repro now
  disposes zero B resources. Source explicitly frees the leaf material.
- Library/Barracks/Forge have 15/20/20 meshes, below the agreed 40 budget.
  Pulse/work/glow over three seconds keep finite matrices; disposing one
  building does not dispose resources of a live sibling.
- Terrain has 14 instanced/other meshes. Sampled playable plateau remains
  flat; no interior trees, blocked-neighbour trees or road-overlap trees in
  the tested seeded map. The new placement policy addresses the baseline
  tree-occlusion finding; recheck after board integration.
- 9b0cac8 adds a smaller showroom margin and clamps river width to it.
  No additional blocker found in this change.

### Units: fd42123 and 8d7e511

- **Closed P1: per-unit draw budget.** fd42123 had 29 to 43 separate meshes
  per unit against the agreed <=12. 8d7e511 bakes the rigid parts into
  SkinnedMesh buckets with one weight per vertex; the current units have
  2 to 3 meshes. Board does not need to merge these meshes.
- **Closed P2: avoid per-frame pose/keys allocation.** The bake change
  reuses target pose and caches POSE_KEYS outside tick. onStrike still
  provides a fresh event position only when a strike fires.
- All four built-ins plus a forged class complete repeated idle, walk,
  work, cast, celebrate and error ticks with finite transforms. Repeating
  play(work) does not restart the animation (five strikes in three seconds).
  Caller wrapper position stays fixed and staffTip follows the animated
  gem through rotated, translated and scaled parents. Disposing A does not
  dispose a live sibling's resources. Vertex-colour team tint needs a
  separate check after the albedo pass; material-colour counting no longer
  measures tint after baking.

### Targets: c7e4c30

- Bug and feature factories at severity 1 through 4 pass engaged/hit,
  defeat, resolved and reopen structural smoke. Matrices remain finite,
  caller wrapper remains fixed, owned animated materials are freed, and
  sibling resources survive disposal.
- **Open P1 for board integration: target draw budget.** Bug camps use
  19/50/93/101 meshes; feature sites use 8/18/29/29. Most exceed <=12.
  Owner already acknowledged and is applying the rigid bake next. Keep
  placeholder targets until the bake is reviewed; this does not prevent
  showing the current assets in the A1 showroom.

### Lighting and FX: 727f7da and 65f5f87

- 727f7da returns the agreed callable update(), closing the missing-method
  cause of the previous blank canvas. Latest showroom renders normally.
- **Closed P2: Infinity flag removal retained an immortal effect.** Original
  repro detached flag meshes but left active=1. 65f5f87 ends the effect;
  after removal and two seconds active=0, with only two particle pools.
- **Closed P2: selection colour lost after hover.** Green -> hover -> select
  now restores green, using stored selection colour.
- **Closed integration mismatch:** lighting no longer writes shadowMap.type.
  ArtFx.scroll accepts the scene's from/to/{color,dur}/onArrive signature.
- Ten-second mixed FX smoke drains all effects, leaves exactly two pool
  objects, and fires arrival callbacks once. Four package tests pass with
  61 assertions; `bun run typecheck` passes.

### Live showroom evidence

At 15:29 Chrome successfully rendered all 24 exhibits on the existing 4620
server. Terrain is visible with clear interior and forest perimeter; Library,
Barracks and Forge have distinct roof silhouettes. Sidebar reports baked
unit counts and over-budget targets consistently with structural checks.
DevTools shows only the Clock and PCFSoftShadowMap deprecation warnings in
the inspected console, no repeated lighting-update exception. Foreground
stats varied from about 87 to 103 fps during brief observation; this is not a
sustained board performance measurement. Focused animation and beam visual
checks remain in progress. No second showroom was started.

## 2026-09-27 15:35 PDT: A1 PASS, hero showroom

Reviewed additional commits `bebe165`, `6993797`, `43a6ddc`, `92e2b75`,
`8e4a644`, `74d62a9`, `7b3217f`, `aaed54f`, `1736c4a`, `c8b8fcd` and
`923edce`; checked the zones fixes in `cc42278`. A1 first-hero acceptance
passes: animated Knight, Library, monster and blue recall beam render at the
board camera angle. This is not A2 board-integration signoff.

- Knight idle/walk/work/cast/celebrate captures show different poses, readable
  team tabard/pennant and intact rigid skinning. The albedo/head pass keeps
  the 2 to 3 mesh budget. setTeamColor(green) produces the same vertex-colour
  arrays as a freshly built green unit for all four classes and a forged type.
- Library shows intact slate roof slopes, stone courses, rose window and
  leaded glass. Blue recall grows from its orb toward the raised staff with
  glyphs/rune circle; gold remember travels back toward the Library. FX
  lifecycle/arrival tests remain green. The 1.8x workflow scroll change adds
  no signature or lifetime regression.
- **Closed target budget P1:** aaed54f uses 2/6/6/6 meshes for bug severity
  1/2/3/4 and two for every feature severity. Sibling-disposal and finite
  state smoke pass. Ogre is visually distinct from the red tents.
- **Closed two target P2s:** hit then defeat left skin emissive at .7, and
  reopening called resetPose/tick before assigning the new state, retaining
  grey skin and collapsed crystal rings. c8b8fcd clears flash on resolved
  entry and assigns state first. Five package tests now pass, including
  round trips for all eight camps. Headless engaged/defeat/open captures
  confirm the ogre collapses, greys, and restores its standing olive form.
- **Closed zones P2s:** 923edce allocated a Set every tick and its gate
  furniture intruded below the scaled unit head. cc42278 caches the waving
  instances and raises the gate/portcullis. A centreline ray through the
  raised south gate is clear at y=.8, 1.0 and 1.2. Instance matrices remain
  finite after 120 ticks; disposing A affects zero B resources. Sample zone
  has 20 meshes; four-zone terrain exhibit reports 37, below the combined
  150 budget. World composition/props changes are being reviewed separately.
- Showroom rig guard and watcher/export changes reviewed. Existing 4620
  service and package typecheck pass. A transient missing ./props import
  occurred while world.ts was being authored; it is resolved in current tree.

Visual evidence is in temporary local screenshots under /tmp/art-review-*,
using the lead-supplied Playwright/SwiftShader tool, then a readiness-aware
variant. Fixed-delay captures initially returned blank with no console errors;
waiting for window.showroom.placed produced actual renders. Captured unit,
monster and FX action sequences reported no console errors. Software-rendered
FPS is not laptop GPU performance evidence.

Two showroom P2s were sent to the lead: ?focus=Knight did not match the actual
Unit: knight name, and fixed zoom cropped the Library steeple. 25df8c4 is the
proposed fix and is under visual recheck. A1 verdict sent to raid-art-plan;
code/art-review updated. Board 4619 with ?art=on is the next acceptance gate.

## 2026-09-27 15:42 PDT: world, outlines and board acceptance in progress

- `cc42278` and `f4f2e5a`: makeWorld and makeProps reviewed. Composed sample
  world has 37 meshes, explicit farm/clutter set 10, empty props zero. Finite
  transforms after ticks; all sampled geometries disposed (37/37 and 10/10),
  no live sibling resource disposal. Focused farm capture shows wheat rows,
  fence/scarecrow, cart, crates, hay and barrels without console errors.
- `25df8c4`: focus alias and height framing visually verified with
  ?focus=knight and ?focus=library. Whole Library steeple and orb fit. Earlier
  direct repo shot/flow invocation lacked playwright-core; lead added
  setup.sh and README, verified setup copies tools into /tmp/art-shot-tool.
- `ae45501` is the actual unit-outline commit; supplied `77441cb` belongs to
  the brain lane. Rigid outline shader reviewed and rendered without errors.
  All classes retain finite animation matrices and correct team recolouring;
  unit mesh counts are 3 to 4 including the hull, under 12.
- `b1491a8`: warm brown global-width hulls extend to camps and crystals.
  All eight camps hide the hull when resolved and restore it when reopened.
  Bug counts 3/7/7/7 and feature counts 3 each remain under 12. Shader/render
  evidence covers the unit hull; focused crystal render is in progress.
- Board `4caaa56`, `74466f8`, `cdd1e5e` reviewed: art bodies, target state,
  world, lighting and FX integration. buildArtWorld passes camps, current
  unit tiles, 9x9 Library plaza and building door rows as exclusions. Current
  1440x900 art-on board frame shows clear Library staging, visible Barracks,
  distinct buildings and readable camps. Baseline tree/HUD findings are
  closed for this viewport. Routing and pick ownership stay with the board.
- `a727e52` closes building material-disposal and target resolved-snapshot
  findings. BuildingView retains a.dispose and calls it on rebuild/teardown.
  Target constructor previously left art open for a resolved snapshot;
  current independent repro gives board=resolved and art=resolved. The fix
  had already landed by the time the repro ran; corrected the notification
  to scene owner. Scene now uses richer recallBeam/orderPing/forgeSparks.
- Board typecheck passes; 17 tests pass with 103 assertions. Art typecheck
  passes; five tests pass with 162 assertions at the latest check.

**A2/A3 live acceptance not yet granted.** Two order probes were interrupted
by shared service/code changes. First supplied flow returned order o64, then
an HTTP 502 and FIXTURE status; its final frame cannot prove live behavior.
Second probe waited for connection=live and backend=mock, received o2, then
Vite navigation destroyed its execution context. Neither order remained in
the subsequent engine snapshot, consistent with a reset but not proof of its
cause. Sent to art lead and engine lead for a stable 30-second mock window.

The off/on performance probe measured the off case at 382 calls, 54,454
triangles, six units/eight targets; on evaluation then lost raidScene during
reload. No comparable performance claim follows from this partial result.
All mutations targeted 4619/4618, never the real demo. Awaiting the FX tuning
commit and stable live flow; Analyst requires both reviewers and look-dir
screenshots before the 16:25 default-on cutoff.

## 2026-09-27 15:59 PDT: A3 Art gate PASS

**PASS for the integrated Art set on 4619 ?art=on.** No remaining Art blocker
found. This is the Art review verdict; Analyst still owns the demo-default
change and requires the UI verdict plus look-dir's final state captures.

Tested source identity: capture run began with HEAD `404327bf`; post-run HEAD
was `f73a5e0`. `packages/art/src/` and `apps/board/src/scene/` were clean at the
checked boundaries and have no diff between those commits. The whole shared
tree was not clean: showroom/exhibits/fx.ts had an unrelated uncommitted edit.
The accepted source includes scene cdd1e5e/a727e52, world cc42278/f4f2e5a and
bc80e40, unit/camp hulls ae45501/b1491a8, shadows c1f21f8, and FX
9a243cc/7eb50a6/28d6c15. Subsequent source edits need their own review.

- 7eb50a6 and 28d6c15 reviewed. Two simultaneous board recalls show narrow
  blue beams with small blue pages and no broad white wedge. Surrounding
  units, Library and terrain remain readable. Source preserves moving
  endpoints, effect cleanup and arrival callbacks. 9a243cc portal source
  reviewed; live board capture shows its violet ring, and lifecycle coverage
  includes portal completion.
- c1f21f8 contact shadows reviewed. Independent probe confirms 4/4/4/5 meshes
  for knight/ranger/scout/oracle and 5 for a forged unit; bug camps 4/8/8/8,
  feature camps 4. All stay under 12. shadow:false removes exactly one draw.
  A celebrating unit's shadow remains a direct child at local y=.012.
  Disposing instances frees zero shared shadow geometry/material/texture
  resources, including across sibling units and all eight camp variants.
- bc80e40 banner self glow reviewed and rendered. Zone flags retain their
  colours on shaded faces; no geometry or tick changes and no shader error.
- b1491a8 focused feature severity-4 image now inspected: crystal and stone
  outlines are intact. Earlier lifecycle probe covers hull hiding/restoration.
- Own 1440x900 live/mock board captures show Library, Forge, Barracks, clear
  staging, farms, river, zone gates and distinct camps. Real mock order o28
  moved u2 with changing authoritative and visual positions. A concurrent
  test replaced it with o29; later recall/remember/idle states remained live.
  This is movement/render evidence, not a claim that my o28 completed.
- The separate UI review in reviews/ui.md records A3 PASS: real mouse picks,
  Forge opening, drag selection, forged unit u7 selection and movement via
  a real mock order, Formation/trio run, and art=off fallback. Independently
  inspected its art-gate-fx.png, including Formation, rings and overlapping
  recall/remember effects. Those interaction results belong to raid-ui-rev.
- Latest Art typecheck passes; five tests pass, 164 assertions. No JavaScript
  page exceptions or shader failures in the capture run. One generic resource
  404 and an additional Vite navigation were observed; no empty-console claim.
  UI review separately records Forge evaluation-detail 404s for its owner.

Own evidence: /tmp/art-a3-board.png, art-a3-recalls.png, art-a3-flow-1.png,
art-a3-flow-8.png and art-a3-flow-15.png. The capture named art-a3-remember.png
missed the gold orb's short lifetime, so it is not proof of that moment.
UI evidence inspected: /tmp/raid-ui-review/art-gate-fx.png.

Native computer control failed twice with a Sky pipe startup error. Used one
isolated headless Chrome without forced SwiftShader, then closed it. Own draw
samples ranged 413 to 508 during changing mock states; this is not an off/on
benchmark. UI review reports a short 61 FPS / 436-call Metal sample, not a
sustained performance guarantee. A4 performance/pitch captures remain with
the milestone owners. All reviewer mutations stayed on 4619/4618.

### Explicit A2 and A3 verdict, 16:00 PDT

**A2 PASS. A3 PASS. No blocking Art findings.** Covered scene commits:
4caaa56, 74466f8, a727e52, cdd1e5e. Covered latest Art commits: 7eb50a6,
28d6c15, c1f21f8, bc80e40, plus 7e2181d (reviewed showroom-only removal of
redundant unit shadow blobs). Earlier accepted asset commits remain included.

At capture boundaries the board-facing Art and scene source paths were clean;
the accepted source is reproducible from 404327bf/f73a5e0. By the final report,
7e2181d had committed the showroom edit and packages/art was clean. A later
uncommitted scene/buildings.ts change appeared: Forge progress-banner styling.
It was not in the captured source, so this PASS must not be represented as a
review of that later visual change or as a claim the current entire tree is
clean. Sent the explicit PASS and this source boundary to raid-art-plan and
raid-look-dir. Analyst retains the final default-on decision.
