# Team UI plan (raid-ui-plan, lead)

Status 15:01: M1 accepted (TEST.md "M1 ui"). Done ahead of plan: live SSE, walking, status looks, recall/remember animations (scene ab79a23), bottom panel, minimap, feed, orders bar, autopilot toggles (hud 29f2964, 2679428), Library and Forge overlays (plan 9717398). Changes: raid-ui-plan owns `src/panels/` (Library and Forge overlays); hud keeps the Barracks panel and the side-panel building summary. core/sim.ts dropped (engine plus mock-bridge are live; `raid.dev.*` injectors cover proposals and memory events). Priority now: hud fits 1200x600 viewports.

Board: `apps/board`, Vite + TS + three.js on 127.0.0.1:4611, /api proxied to the engine on 4610. Run: `cd apps/board && bun install && bun run dev`. Before every commit: `bun run typecheck && bun test test/` in `apps/board`. Commit only your own folder, then `herdr agent prompt raid-ui-rev "review <sha>: <line>"`.

## Shared interface (src/core, owned by raid-ui-plan; ask before relying on anything not listed)
- `import { api, type Store, type Bus, type Unit, ... } from "../core"`. Contract types are re-exported; `EngineEvent` and `FeedEntry` are board types in `core/types.ts`.
- Entries: `src/scene/index.ts` exports `mountScene(el, store, bus)`, `src/hud/index.ts` exports `mountHud(el, store, bus)`. `main.ts` mounts both via `import.meta.glob`, so either may be missing.
- Store: `getState()`, `subscribe(state => ...)` after every change, `onEvent((ev, state) => ...)` for raw engine events after they are applied (use for one-shot animations), `feed(unitId?)` activity feed, `unit/target/order/team(id)` lookups, `connection` + `onConnection(fn)` ("connecting" | "live" | "reconnecting" | "fixture").
- Bus: `select(ids, {add})`, `selectTarget(id)`, `selectBuilding(id)`, `clear()`, `hover(ref)`, `focusTile(x, y)`, `on("selection" | "select" | "selectTarget" | "selectBuilding" | "hover" | "focusTile", fn)`. `bus.selection = {units, target, building, focus}`; `focus` tells the HUD which panel to show.
- API: never throws, resolves `{ok: false, error}` on failure. `api.post/get/patch(path, body)` plus helpers: `order, cancelOrder, goOrder, adjustOrder, spawn, patchUnit, message, assignTeam, patchTeam, forgeType, graph, search, page(slug), brainStats, reset`.
- Engine down: the store holds `fixtureState()` (6 zones, 3 buildings, 6 units on 2 teams, 8 targets, 3 orders, a training Forge type) and `connection = "fixture"`. Console: `raid.store`, `raid.bus`, `raid.api`.
- Split of the screen: scene owns the canvas and everything in world space (terrain, meshes, picking, camera, box select, ghost arrows, animations). HUD owns DOM: top resource bar, bottom panel (command grid left, portrait and stats middle, minimap right), side panel, orders bar, building panels. Keyboard: scene owns WASD and camera keys; core owns control groups (1..9, Cmd/Ctrl+1..9, Esc).

## M1 (15:05): static board from state, click to select
raid-ui-scene
1. `scene/index.ts` mountScene: renderer, orthographic camera at the isometric angle (tile to world helper in scene/util.ts), resize handling. Check: grass plane 24 x 24 visible, no console errors.
2. Zones: walled district plate per component with a banner label; paths and a few trees and rocks. Check: 6 fixture zones visible with names.
3. Buildings: Library (stone monastery), Barracks (timber), Forge (smithy with glowing furnace) at their tiles. Check: 3 distinct buildings.
4. Units: low-poly characters with staff, tinted by team colour (grey if no team), class silhouette differs (knight, ranger, scout). Targets: camps or monsters sized by severity, dim when resolved. Reconcile by id on `store.subscribe`. Check: 6 units, 8 targets from the fixture.
5. Picking: left-click unit `bus.select([id])` (shift adds), left-click target `bus.selectTarget`, left-click building `bus.selectBuilding`, empty ground `bus.clear()`. Selection rings from `bus.on("selection")`. Right-click target with units selected: `api.order({unitIds, targetId})`. Check: clicking a unit shows its ring and the HUD panel.
6. Pan (drag, WASD) and zoom (wheel, clamped). Check: whole map reachable.
raid-ui-hud
1. `hud/index.ts` mountHud and the AoE layout shell: top bar, bottom panel, side panel (parchment and stone CSS). Check: layout renders over the canvas without blocking clicks on empty areas.
2. Top bar: tokens, spend, Library pages, idle agents, open issues, backend and connection badge. Check: numbers match the fixture (18250 tokens, $0.42, 42 pages, 3 idle, 7 open or engaged).
3. Unit panel (focus "units"): name, class, model, effort, team, status, current order and target, activity feed from `store.feed(id)`, reply, message box posting `api.message`, "Open in QM" when `qm.sessionUrl` is set. Multi-select shows a unit strip. Check: `raid.bus.select(["u1"])` shows Ada working on LUM-12.
4. Target panel (focus "target"): issue id, title, component, kind, severity, status, customers, units engaged. Check: `raid.bus.selectTarget("t12")`.
raid-ui-plan
1. Scaffold and core (done, b1a7c26). 2. Integration check with engine 4610 and mock-bridge 4615; TEST.md M1 line; devbrain `code/board`; ping Analyst.

## M2 (15:25): live
raid-ui-scene
7. Walking: tween between `unit.moved` positions (smooth, facing direction), walk cycle bob while status "moving". Check: with the engine plus mock-bridge, ordered units walk to the target.
8. Working animation (staff swings or sparkles at target), recalling and remembering placeholder (staff raised). Engaged targets show a fight or smoke effect; resolved targets fade. Check: statuses are visually distinct.
9. Hover highlight via `bus.hover` and a cursor change on units and targets.
raid-ui-hud
5. Live activity feed per unit and a global feed (bottom left, last 6 lines) from `store.feed()`. Check: tool calls including gbrain.* appear within a second of the event.
6. Reply rendering in the unit panel when the order is done (markdown-lite: paragraphs, code). Order status chip.
7. Command grid (left of bottom panel): Order (hint: right-click a target), Message, Recall, Remember, Open in QM, Retire (disabled if the engine lacks it). Check: buttons call the API and show errors as toasts.
raid-ui-plan
3. `core/sim.ts`: when connection is "fixture", orders placed through `api.order` are simulated locally (walk, recall, work, remember, reply) so scene and HUD can test M2 to M4 without the engine. 4. Integration test live against the engine.

## M3 (15:45): RTS controls and autopilot
raid-ui-scene
10. Box select (drag on empty ground with left button; drag with right or middle pans), shift adds.
11. Ghost arrows from unit to target for `proposed` orders (dashed, team colour) and solid thin lines for active orders when selected.
raid-ui-hud
8. Orders bar (above the bottom panel): one card per proposed order with a countdown ring to `vetoDeadline`, reason, Cancel, Adjust, Go now. Adjust sets `bus` command mode (core adds `bus.command`, see plan step 5) and the next target click adjusts.
9. Autopilot toggle per team (`api.patchTeam(id, {autopilot})`) and team badges with their control group number.
raid-ui-plan
5. `core/keys.ts`: Cmd/Ctrl+1..9 assigns the selection to team n (`api.assignTeam`), 1..9 selects the team, double press focuses the camera, Esc clears. `bus.command` for Adjust mode. 6. TEST.md M3.

## M4 (16:05): memory and buildings
raid-ui-scene
12. Recall: staff raised, blue beam from the Library to the unit, a page icon flies to the unit (on `memory.recall`). Remember: gold orb flies from the unit into the Library, the Library pulses (on `memory.remember`).
13. Forge furnace glow pulses while a type is training; new units walk out of the Barracks or Forge on `unit.spawned`.
raid-ui-hud
10. Library panel (focus building "library"): knowledge graph from `api.graph()` (2D canvas force layout, nodes coloured by type), memory feed from `state.memory.recent`, search box (`api.search`), click a node or hit to show the page (`api.page(slug)`).
11. Barracks panel: Train unit buttons per built-in class (`api.spawn({class})`), team picker.
12. Forge panel: form (type name, job description) calling `api.forgeType`, list of `state.unitTypes` with source "forge" (progress bar, stage text, eval score if present), Train unit once ready.
13. Minimap (bottom right): zones, units as team dots, targets as red dots; click calls `bus.focusTile`.

## M5 (16:25): polish
scene: lighting, shadows, performance (instancing if needed, 60 fps with 30 units). hud: polish, toasts, empty states. plan: demo path run twice, TEST.md M5.

## Review (raid-ui-rev)
Per commit: typecheck, `bun test test/`, dev server boots, no console errors with the fixture and with the engine, contract field names match `contract/types.ts`, no writes outside the author's folder, no secrets.

## W1 (16:00, 4619 on the mock) and W2 (16:20, real QM on 4611): team workflows
Spec: docs/CONTRACT.md "Team workflows", docs/lanes/flow.md. Core (done, 157675c): `api.setWorkflow(teamId, {preset} | {workflow})`, `api.clearWorkflow(teamId)`, `state.workflowRuns`, `store.run(teamId)`, feed kind "handoff", fixture trio on team 1 with a running run, `raid.dev.workflow(teamId)` and `raid.dev.handoff(from, to)`.
raid-ui-hud
14. Team view in the side panel when the selection is exactly one team (chip name or digit key): Formation with a preset picker (solo, pair, trio, fanout), role slots with member dropdowns (custom graph), a small node-link diagram with live node state from `store.run(teamId)` (active, done, changes, approved), loops count, Clear. Check: picking trio on 4619 calls PUT and the diagram shows planner, implementer, reviewer.
15. Orders bar shows running runs (team, target, active role, loops) with Cancel (cancels the run's active orders). Check: right-click a camp with the team selected starts a run and the card follows it to done.
raid-ui-scene
14. Role badges above workflow units; a faint team-coloured link line along the graph edges during a run, active node highlighted.
15. Handoff animation on `workflow.handoff`: a scroll flies in an arc from unit to unit, summary float over the receiver (effect from raid-art-fx).
raid-ui-plan
7. W1 check on 4619: trio on a team, order the team, see planner to implementer to reviewer, one changes loop, approved, target resolved; TEST.md "W1 ui". 8. W2: one trio run on real QM through 4611 with the Analyst's go; TEST.md "W2 ui".
