# Team Look: make the board look and read like a 2026 AAA strategy game
Agents: raid-look-dir (director and lead), raid-look-hud (implementer, HUD), raid-look-panels (implementer, building panels), raid-look-rev (reviewer, visual critique).
Emre's verdict after playing it (15:25): "everything looks great" functionally, but the visuals feel "very very AI slop": the interface, the buttons, the wording around sections. Target: a 2026 AAA strategy game. Work in screenshot iterations.

## Ownership (moved from team UI at 15:25)
- raid-look-dir: `apps/board/tools/shoot.ts` (screenshot script), `docs/shots/look/`, `docs/lanes/look-plan.md`. Does not edit board code.
- raid-look-hud: new `apps/board/src/theme/` (design tokens CSS, SVG icon set, fonts from the system stack, portrait renderer), `apps/board/src/hud/hud.css`, and `apps/board/src/hud/{topBar,sidePanel,bottomPanel,globalFeed,chips,notices,minimap,barracks}.ts`. raid-ui-hud keeps `hud/formation.ts`, `hud/ordersBar.ts`, `hud/index.ts`, `hud/dom.ts`.
- raid-look-panels: `apps/board/src/panels/*` (Library, Forge, graph) and `panels.css`. First job: the Library graph area renders empty (seen 15:24 on 4619 with 88 pages); fix it.
- World labels, nameplates and issue markers live in the scene (raid-ui-scene) and art (raid-art-*): the director sends them concrete requests with screenshots.

## Loop (every 10 to 12 minutes until 16:35)
1. raid-look-dir runs `bun apps/board/tools/shoot.ts` against the test board http://127.0.0.1:4619 (mock engine 4618; never 4611) at 1512x790 and 1280x720, capturing fixed states: overview, unit selected, several units selected, Library open, Forge open, Barracks open, autopilot proposals in the orders bar, a workflow run in progress, feed busy. Headless Chrome or Playwright; kill only your own browser PIDs. Files go to `docs/shots/look/<iteration>-<state>.png`.
2. Director and reviewer critique each shot against the brief below (view the images), write a short numbered punch list per owner in `docs/lanes/look-plan.md`, and send it by herdr prompt.
3. Implementers fix, commit, push, and ping the director. Next iteration.
Checkpoints for the Analyst: iteration shots at about 15:45, 16:00, 16:15, 16:30.

## Brief: what "2026 AAA" means here
- Kill the slop tells: no emoji anywhere (top bar, feed, chips, portraits, buttons); no chess-glyph portraits; no raw slugs or epoch timestamps (`lum-101-u2-1790547743590`); no duplicated names ("Ada Ada: plan"); no instruction paragraphs on screen ("Click a unit to select it..."), use tooltips and a one-time fading hint instead; no "Name · Subtitle" dot compounds on world labels; no placeholder prose ("Nothing yet.", "Select a unit, an enemy camp or a building.").
- Visual language: dark, slightly translucent slate panels with a thin warm-metal hairline border, subtle inner shadow and bevel; one accent per system (team colours, GBrain gold, River blue); a consistent 8 px grid; crisp typography from the system stack (a condensed small-caps face for headers, e.g. "Avenir Next Condensed" with fallbacks; tabular numerals for resources); a custom monoline SVG icon set on a 24 px grid for every resource, command and memory event.
- HUD: top resource strip that is numbers first with icons and tooltips; bottom command card with square icon slots, hotkey corner marks, hover glow, pressed and disabled states; a portrait rendered from the unit's actual 3D model; status as coloured pips and thin bars, not pills; the minimap framed like the rest.
- Wording: terse game voice. Section headers of one or two words; buttons of one word with a hotkey; feed lines as icon + name + short verb phrase + object title ("Bram recalled Billing rules"), relative times ("12s"), human page titles not slugs. Keep product names where they are the point (GBrain, River, QM) but as small secondary marks, not in every label.
- Motion: 120 to 180 ms eases on hover, open and close; panels slide or fade; nothing bouncy.
- Panels: the Library reads like a codex (graph as the hero, readable node labels, legend as small chips, page view with a proper title and body); the Forge reads like a production queue (type cards with a progress bar, stage, eval score as a clear trained-vs-base comparison).
- Performance: keep 60 fps; no blur on large areas if it costs frames.
- Only original assets (no downloaded icon packs or fonts unless their licence is clear and they are vendored; prefer hand-written SVG).
