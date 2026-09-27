# UI review log

Reviewer: raid-ui-rev. Owner of this file only; implementation fixes go to the path owner.

Current checkpoint: A3 UI art-on and off-fallback checks PASS on 4619; full Formation click-through and forged-unit selection/movement pass. All reported UI P2s in this batch are verified fixed. Latest board validation: 20 tests / 119 assertions, typecheck and build pass. No JavaScript page errors; test Forge evaluation fetch 404s remain a reported network caveat. Analyst owns the final default-art decision after the other gates.

## Review procedure

1. Read each submitted commit with `git show <sha>` and record its scope.
2. Check shared `contract/types.ts`, engine-only HTTP access, fixture fallback, and safe rendering of synthetic service text.
3. Run the board's smoke test and type/build checks once its scaffold exists. Record the commands and actual results.
4. Report actionable bugs, crashes, secrets, and contract mismatches to the implementer, most severe first. Copy raid-ui-plan on blockers.
5. Recheck fixes, append evidence here, commit only `reviews/ui.md`, and update `code/board-review` in the dev brain.

## M1 acceptance checks

- Board serves on 127.0.0.1:4611, proxies `/api` to 127.0.0.1:4610, and provides `/health` with `{ok: true, service: "board"}`.
- Type/build and service smoke commands succeed, with no imports from another service's implementation.
- Isometric scene mounts with zones, Library, Barracks, units, and targets from the state endpoint; unavailable engine shows fixture state.
- Unit and target selection agree between the scene and HUD. Empty selection and stale IDs do not crash either mount.
- Selected unit shows name, class, model, status, order, activity, and reply; selected target shows issue and customers.
- Message submission uses `/api/units/:id/message` with `{text}`; QM link is shown only when a session URL exists.
- Synthetic names, titles, messages, and replies render as text without creating executable markup.

## 2026-09-27 14:46 PDT: intake

- Read `docs/COMMON.md`, `docs/PLAN.md`, `docs/CONTRACT.md`, `contract/types.ts`, and `docs/lanes/ui.md`.
- Repository had no board implementation or submitted UI commit at intake. Build, smoke, and browser checks are pending, not passed.
- Asked Analyst to reconcile the contract example's numeric `Target.issue` and string memory timestamp with the shared types' string issue and numeric timestamp. Shared types are the current review reference.
- Asked Analyst to specify engine proxy routes for the M4 Library graph/search/page UI, preserving the engine-only dependency rule.
- Notified raid-ui-plan, raid-ui-scene, and raid-ui-hud in Herdr session `default` that review is ready.

## 2026-09-27 14:47 PDT: contract clarification

- Read contract v3 commit `75dc182` and the updated shared types. `contract/types.ts` is authoritative, timestamps are epoch milliseconds, and issue IDs are strings such as `LUM-12`.
- Library APIs are `GET /api/brain/graph`, `/api/brain/search?q=`, `/api/brain/page?slug=`, and `/api/brain/stats`. Slugs are URL-encoded query values, not path segments.
- Intake contract questions are resolved. Bridge terminal events now carry optional order IDs for stale-completion filtering in the engine; the board continues to consume only engine state/events.

## M1 scaffold review: b1a7c26

Scope: scaffold, core store/reducer, API, SSE, fixture, selection bus, main mounts, and health middleware. Read the submitted diff. Scene and HUD files were uncommitted work during this review.

### Open finding

- **P1: a delayed initial HTTP state response can undo newer SSE state.** `apps/board/src/core/sse.ts:12-15` starts GET `/api/state` concurrently with EventSource and unconditionally applies the HTTP result. Reproduced by delaying fetch, delivering a snapshot with u1 at (22, 22) plus an idle status event, then resolving fetch with the older fixture. The unit reverted to (5, 4), working. Ignore the HTTP result after accepting an SSE snapshot/event, or sequence initialization so an old HTTP response cannot replace newer stream state. Sent the reproduction to raid-ui-plan; request a regression check.

### Verification

- `cd apps/board && bun install`: passed, no dependency changes.
- `bun test test/`: 4 passed, 0 failed, 32 assertions.
- `bun run typecheck`: failed only at uncommitted HUD `sidePanel.ts` lines 104, 170, and 188, where nullable nodes are passed to append. No core diagnostics. Full board build is not approved yet.
- `bun run dev`: started Vite 8.3.1 successfully. Reviewer-started process listens only at 127.0.0.1:4611 (PID 60063); left running for the UI team.
- `curl -fsS http://127.0.0.1:4611/health`: returned `{"ok":true,"service":"board"}`. `/src/main.ts` served successfully.
- Browser render and scene/HUD integration remain pending their submitted commits.
- Read shared EngineEvent update `ca1a93d`. Lead notified to replace the local event union with the shared export; `forge.updated` now definitively carries `unitType`.

## M1 scaffold fix review: 16d1c55

- Read the complete fix diff and `docs/lanes/ui-plan.md` (`969f9e9`).
- **P1 above resolved:** the initial HTTP result is ignored after an SSE message arrives. The added regression reproduces the delayed GET sequence and asserts the newer position, status, and live connection remain intact.
- Core now re-exports `EngineEvent`, `EngineEventType`, and `ActivityKind` from `contract/types.ts`; Forge reducer reads the authoritative `unitType` field.
- `bun test test/`: 5 passed, 0 failed, 35 assertions.
- `bun run typecheck`: passed on the current working tree; previously observed uncommitted HUD diagnostics are gone.
- `bun run build`: passed (17 modules). This build still has no scene entry, so it is not evidence of a completed M1 board.
- No remaining actionable findings in the submitted scaffold/fix scope. Browser integration remains pending scene/HUD submissions.

## Contract follow-up: Codex class map

- Analyst clarified the shipped QM harness is Codex: knight = `gpt-6-astra` / high, ranger = `gpt-6-sol` / medium, scout = `gpt-6-luna` / low.
- **P2 pending:** the fixture still labels its units and built-in types with Claude model names. Asked raid-ui-plan to update `src/core/fixture.ts` to the new contract map so fixture-mode unit panels show the supported models.

## M1 HUD and controls review: bfdfcd5, fc4bec8, 24bf23b

- Read each submitted diff. The class-map P2 is **resolved by 24bf23b**: all fixture units and built-in types use the contract's Codex models and efforts.
- Board smoke: 5 tests passed, 35 assertions; typecheck and build passed.
- Isolated DOM checks used a temporary Happy DOM harness outside the repository. Verified unit/target/Library selection, multi-unit roster, missing IDs, top-bar stats, activity updates, agent text as text nodes, and blocking JavaScript session URLs. Message request body and path match the contract.
- Controls checks passed: group select, double-press focus, assignment POST, typing guard, target and unit adjustment, normal order POST, Escape cancels a command before clearing selection.
- Notices checks passed: safe error text, four-toast cap, visible command hint and Cancel clearing the command.
- **P2 open, assigned to raid-ui-hud:** `sidePanel.ts:237-241` applies send completion to whichever unit is currently shown. Reproduced: delay u1's message response, select u2, type a draft, then resolve u1's response. The u2 draft becomes empty and displays `Sent.`. Scope completion to the original selection/submission generation and clear only an unchanged submitted draft. Same-unit edits made during the request also need preserving.
- Browser inspection was interrupted by concurrent desktop use. Stopped native input; no browser visual/console pass claimed. Lead notified to include that in M1 integration.

## M1 scene review: b93e90e

- Read scene code: mount/reconcile/input, camera, terrain/zones, buildings, units/targets, and helpers. `bun run build` passed with scene included (30 modules); Vite reports a non-blocking large Three.js chunk warning.
- Isolated scene checks used real Three.js geometry/raycasting and real input listeners with a mocked renderer and canvas drawing context. Verified 6 units, 8 targets, 3 buildings; unit/target/Library picking; right-click target POST; movement interpolation; and zoom calculations. This does not verify WebGL pixels or GPU behavior.
- **P2 open, assigned to raid-ui-scene:** holding W over the canvas, focusing the HUD message textarea, then releasing W leaves camera movement latched. HUD stops keyup propagation, so scene's bubbling window listener never clears the held key. Reproduced continued movement of 0.19 tiles in the following frame. Capture keyup and/or clear held keys on focus into editable controls; match cleanup to listener registration. Copied HUD and lead.
- No M1 build blockers found. Visual render and browser-console checks remain unverified by reviewer.

## M1 follow-up: dd7cd25, 65e26c7, 29f2964, 7bb7714

- Corrected the submitted HUD SHA: expansion/fix is `29f2964`; `ac78e4d` is a reviewer-log commit. Read the actual HUD expansion diff and the later keyup fix.
- **Message-draft P2 resolved in 29f2964:** the delayed u1 completion leaves u2's new draft and notice untouched. Separate check confirms edits to the same unit's draft also survive completion.
- **Latched-W P2 resolved in 7bb7714:** repeating W down over canvas, focus textarea, release W yields zero further camera movement. Scene-side capture/focus robustness remains optional.
- Bottom-panel isolated checks passed: command buttons resolve current selection without needing a grid rebuild; Recall, Message, Order, two-click Retire with DELETE, Barracks spawn, and minimap coordinate inversion. Global feed text and six-line cap behave as intended.
- `dd7cd25`: retirement reducer removes unit/team membership, and `linkSelection` removes it from selection. Shared contract includes DELETE and `unit.retired`.
- `65e26c7`: proposal deadline is relative to current time. Dev proposals, recall, remember, and status mutations produce local store events without network requests.
- `bun test test/`: 6 passed, 0 failed, 38 assertions. Typecheck, production build (34 modules), and board `/health` pass.
- Lead-provided browser evidence (`d5b3014`, `docs/TEST.md` M1 ui): live world renders, unit/target click panels work, right-click order u1 to t108 walks and recalls, no console errors on load. Distinct from reviewer's mocked-renderer evidence.
- Analyst rule recorded for future Forge reviews: any check creating a type must pass `dryRun: true`; real River training is reserved for demo types. All command checks in this review used a mocked fetch.

## Animation review: ab79a23

- Read FX, scene wiring, unit and target changes. Tested real geometry/event handling with mocked rendering: recall and remember create transient objects, then object count returns to baseline after simulation; all transforms remain finite. Error tint and resolved fade update correctly.
- Capture-phase keyup and editable focus clearing pass the held-key scenario. No new actionable findings in this commit. Visual appearance still requires browser verification.

## Orders and Barracks review: 2679428, 96282ab

- **P2 found in 2679428, resolved by 96282ab:** a retained proposal card captured its initial unit ID. Reassigning order o3 from u1 to u2 changed its title to Brom, while click and hover still targeted u1. The fix updates Card.unitId and reads it at event time; rerun shows title, selection, and hover all reference u2.
- Countdown/urgency checks, Cancel and Go request paths, Adjust cleanup when the card disappears, stopping the timer when no cards remain, current-state autopilot toggles, and colour injection rejection pass.
- Read detached side-panel rendering and Barracks additions in the corrected SHA `96282ab`. Barracks selection persists through state refresh and Train sends the selected class/team. No new actionable findings there.
- Board smoke remains 6 passed / 38 assertions; production build and typecheck pass.

## Library and Forge panel review: 9717398

- Read all seven changed files. Isolated checks pass for safe markdown text/wikilinks, ready-only Forge Train requests, and expected engine proxy query encoding. No Forge type was created during review.
- **P2 open, assigned to raid-ui-plan:** `LibraryPanel.openPage` and `search` do not discard superseded responses. Reproduced page A then B, resolving B before A: graph selection remains B while the page shows A. Search alpha then beta, resolving beta before alpha: results mix Beta and Alpha under the beta query. Track separate request generations for page/search and invalidate on empty query/reset; only the latest request may update the UI.
- Lead reports live brain browser verification (31 pages, 78 links); independent reviewer tests used mocked HTTP responses to exercise reordered completions.


## Library request fix: 0cbfb2c

- Page, search, and graph generations discard superseded requests. Repeated page A/B and search alpha/beta with reversed responses: only B and beta remain. Clearing the query also invalidates an in-flight search. P2 resolved.
- Added regression passes. Board smoke: 7 tests, 40 assertions; typecheck and production build pass.

## Scene controls and effects: 05de415, e11c0d9, 4754060, eb93486, cc4c7b9

- Real Three geometry with mocked rendering passes box selection, shift-add, empty-box clearing, empty shift-box preservation, right/middle/alt/space panning, no command from a pan, and pointer cancellation.
- Arrow lifecycle matches proposed orders and active orders of selected units. Transforms remain finite and removed orders remove their arrows. Merged buildings still ray-pick; Library orb remains attached and animated.
- Spawn events start built-in units at Barracks and forged units at Forge, then move toward their authoritative position; new snapshot units start at their destination. No API command was sent in these checks.
- **P2 found in e11c0d9, resolved by cc4c7b9:** spreading the building view after computed world points overwrote the chimney top with local coordinates. Fixture Forge sparks appeared at [0.8, 2.25, -0.6] instead of [4.3, 2.25, 19.9]. Fix moves computed points after the spread; exact reproduction now matches the expected world position.
- Read 4754060 walk-speed/resolved/retirement effects, eb93486 invisible pick volumes, and cc4c7b9 title tags/empty-ground ping. Existing unit and target ray-picking checks continue passing with invisible hit volumes.

## Responsive HUD: d62bc78

- Independent isolated headless Chrome loads 4619 with backend mock, live SSE, six units, and a scene canvas. Normal fixture HUD fits 1200x600 and 1512x790: side and bottom panels stay in bounds, minimap scales, cards receive pointer events while dock gaps are click-through. Screenshots are temporary /tmp/raid-ui-review/hud-1200.png and hud-1512.png. Rendering uses software WebGL, not a hardware performance measurement.
- **P1 open, assigned to raid-ui-hud; lead copied:** dock max-height plus overflow:hidden makes veto controls inaccessible once proposal rows exceed its height. Reproduction at 1200x600 with eight synthetic proposed orders: bottom cards occupy y426..511 but dock ends y464, clipping Cancel/Adjust/Go. There is no scroll access. Give proposals bounded scrolling and prevent flex shrink from pushing the last row outside the dock. Screenshot /tmp/raid-ui-review/hud-many.png.
- Console collection showed a missing resource (404) and the intentionally aborted fixture SSE request; no JavaScript page error or mount failure.
- Automated checks now use mock engine 4618 and lead-owned test board 4619. Do not send automated commands to real-QM engine 4610 or demo board 4611. No Forge type was created; any future creation check requires dryRun:true.


## Responsive dock fix and HUD follow-ups: af72769, 27f39ca, ccaa4d8, 295bb44

- **Dock P1 resolved in af72769:** independent headless Chrome at 1200x600 with eight unique unit/proposal pairs and six feed entries gives a 350px scroll viewport with 380px content. After scrolling, the last Go now button occupies y439..464 and elementFromPoint hits that button. Screenshot /tmp/raid-ui-review/hud-scroll-fixed.png.
- Normal HUD bounds also pass at 1512x790. Idle/open resource cycling selects distinct idle units and an unresolved target. Error text containing an HTML tag remains text; no page errors in this browser pass.
- ccaa4d8: RowList preserves surviving nodes when truncating and appending, resets on replacement/empty; slug chips deduplicate, cap at four, show +n, and emit the full slug. Numeric forged hue and sanitized team color pass.
- 295bb44: minimap clips a valid footprint and filters non-finite corners. Camera view stream is checked with 56c7e32/87e7793: four ground corners after a camera change, no duplicate event on an unchanged frame. Camp double-click selects active-order units.

## Routing review: c3ef25a, 2118582; labels: 7e1e713

- **P2 found in c3ef25a, resolved in 2118582:** using total routed path length as the teleport threshold caused ordinary engine moves to snap units across walls. Reproduction: fixture u1 from (5,4) toward (12,1), the nearest available neighbor of t22, at three engine steps/second and 60 render frames/second. At engine (9,1), visual position jumped from [5.209,0,6.466] to [9.663,0,1.556] in one frame.
- Fix bases teleport on direct displacement while routed length only affects speed, capped at ten tiles/second. Exact reproduction is smooth; 48 fixture unit/target trajectories now have zero jumps over one tile/frame (previously twelve).
- 4754060 transition checks also pass: resolving an existing target emits burst/text once, repeated resolved updates do not; retiring removes the unit and emits a puff. Read 7e1e713 Library label and Forge banner adjustments; no actionable finding.

## Core feeds, page navigation, and Forge list: a3ba014, 07a3bf0, 3e5696e, b389710, 191116c

- View event type agrees with the scene/minimap. bus.openPage selects Library and renders the URL-encoded page request. Shared slug metadata reaches recall/remember/tool feed entries; snapshot backfill includes memory/replies once without duplicate rows on a second snapshot.
- Forge list puts ready types first; failed types are inside initially closed details and cannot Train. Existing ready-only Train and Barracks team payload checks still pass. No Forge creation request was sent.
- Latest working-tree smoke before workflow review: 10 tests, 51 assertions, typecheck pass (includes in-progress whole-team order coverage). Most recent production build passed with 46 modules; Three.js chunk-size warning remains non-blocking.

## Workflow core review: 157675c

- Read updated authoritative types, Team workflows contract, docs/lanes/flow.md, and W1/W2 UI plan. Automated workflow checks stay on 4618/4619; real-QM W2 requires the lead's coordinated single run.
- Normalization and workflow event reducers match the contract. PUT/DELETE workflow paths and bodies pass with mocked fetch. Local trio simulator emits planner, implementer, changes, implementer, approved, finishes with one loop, and sends no network requests.
- **P2 open, assigned to raid-ui-plan:** store.run promises the latest running run but uses Array.find, returning the oldest. With fixture w1 running, raid.dev.workflow(1, undefined, 1) creates dev-w1 yet store.run(1) remains w1 throughout the simulation; the Formation consumer would show static fixture progress. Prefer the newest running run or retire the fixture run when starting a local simulation.


## Workflow fix and whole-team commands: 78ca8fb

- **157675c P2 resolved:** store.run now returns the newest running run, falling back to newest completed. Starting the local simulator cancels the existing fixture run. Exact reproduction now returns dev-w2 while dev-w2 runs, then shows its completed state.
- commandTarget sends {teamId,targetId} for an exact workflow-team selection; a partial team still sends {unitIds,targetId}. Regression checks cover both. Existing Adjust branch remains ahead of normal team commands.
- Final checkpoint: 11 tests pass, 55 assertions, typecheck and production build pass (46 modules), 4619 health returns ok. No remaining actionable findings in this reviewed batch. Workflow UI and full mock/real engine runs are future W1/W2 work, not claimed as complete here.

## Framing and hotkeys: 98bc5f3, c2529f9

- 98bc5f3 accepted. Headless Chrome on 4619 with isolated fixture state passes projected-content bounds at 1440x900, 1200x700, and 1200x600. Vertical ranges match the padded safe area: 60..704, 60..529, and 60..450 respectively. Screenshots confirm Billing and Barracks are fully visible above the bottom panel; no page errors. Temporary screenshots: /tmp/raid-ui-review/fit-1440-900.png and fit-1200-700.png.
- Resize reframes before manual input. After wheel zoom, a subsequent resize preserves camera target and zoom. Read the Library 9x9 tree exclusion; no actionable finding.
- c2529f9 accepted. Isolated hotkey checks pass current-selection resolution, visible key badges, Message/Order/Recall, input/textarea/select/contentEditable guards, modifier/repeat/reserved-key guards, two-press Retire, Barracks K/R/C, building V focus, and listener removal on dispose. Requests are mocked.
- Board smoke remains 11 passed / 55 assertions; typecheck and production build pass. No new actionable findings in these submissions.

## Workflow scene and Formation: a504d9b, 42670ce, 9845f3d, dad9896

- a504d9b and 42670ce accepted. Isolated real-Three geometry checks pass role badges, following unit positions, active-node glow, changes-edge highlighting, removal of links at terminal status, custom role changes, and graph removal. Handoff events create one scroll, arrive once, normalize and truncate summary text to 52 characters, then dispose effects. Missing unit IDs are a no-op; transforms remain finite.
- Headless Chrome on isolated 4619 fixture state shows the scroll and Formation during handoff (temporary workflow-handoff.png). Local trio simulation completes one changes loop, removes links and active glow, and keeps role badges, with no page errors. The extra completed-state screenshot timed out; no successful capture of that final state is claimed. This local simulation is not the full W1 engine acceptance.
- 9845f3d had two P2s: a failed role assignment restored an old team's panel after selection changed; a finished fan-out branch did not refresh its run row while the final array step remained active. Both sent to HUD and lead, and both verified fixed in dad9896. Original race now leaves Blue's empty role slots and no Red diagram; the completed branch row now contains its new summary and done state.
- Formation checks also pass persistent role selects, node click selection, current active order cancellation, diagram states, and preset member-count guards.
- dad9896 run cards pass current active-order cancellation, selection using current team members, persistent DOM, live 8-second completion expiry, loaded-result expiry from last step time, 5-minute alert expiry, and dismissal persistence.
- **P2 open, assigned to raid-ui-hud:** run buttons marked hidden remain visible because .hud-btn display overrides the browser's hidden style. Independent Chrome with the committed hud.css and workflow.css reports running Dismiss hidden=true but display=block and width=80px. The user can dismiss a running card, which returns on the next state and then suppresses its terminal result; terminal Cancel is also visible but inert. Add a scoped hidden display rule for run controls. Sent to owner and lead.

## Unit visibility and issue spawn: 06786b5, 5d2403f, e31bdc0, d31400a

- 06786b5 accepted. A synthetic forged unit at the Barracks center draws at the door row after walking, retains the authoritative engine position, ray-picks by unit ID, and sends the expected right-click order through mocked fetch.
- 5d2403f accepted with the new core target.spawned reducer. An event creates the TargetView at y=-0.9 and scale=.3 with one portal; a following target.updated does not restart it. The animation ends at y=0 and scale=1; effects disappear and their geometry/materials dispose. Snapshot-added targets do not animate.
- e31bdc0 core formation reviewed: exact-team reuse, lowest free group, role-holder swap, outsider join before graph PUT, and click command consumption pass the board regression. Requests remain mocked.
- d31400a is the actual spawn-dialog commit (the supplied a3001a5 is an unrelated art review). Shared contract now makes the brain the sole issue ID allocator and returns 503 when unavailable. The UI uses POST /api/targets and the shared target.spawned event; no local fallback target is created by the production dialog.
- Random and explicit form requests, N/typing/Escape handling, focus/toast result, and target upsert before subscribers pass board tests.
- **P2 open, assigned to raid-ui-plan:** newIssue.ts clears and closes a newer draft when an older spawn request succeeds. Reproduced with delayed mocked fetch: submit First issue, close and reopen, type Next issue draft, then complete the first request. The newer dialog becomes hidden and the draft becomes empty. Preserve the opening/submission generation and changed fields, or prevent editing/reopening during a request. Same-opening edits while pending also need preserving.
- Checkpoint: 14 tests pass / 80 assertions, typecheck and production build pass (66 modules). No reviewer orders, messages, or issue creations sent to the real-QM services. New issue HTTP integration remains the lead's mock-engine milestone check.

## Follow-up checkpoint: Formation, art flags, Loadout, demo snapshot

- 2dbbd58 closes the spawn-dialog draft P2: exact close/reopen reproduction leaves the newer dialog and title intact; same-opening edits and unchanged-success behavior pass its regression.
- 4056fc2 closes the hidden run-button P2. Independent Chrome with .hud-orders ancestry now computes hidden Dismiss as display:none and zero width. Revised Formation checks pass mixed-selection team creation, eight preset member guards, duel parallel entry columns, armed role and bench swap, stable slot DOM on status updates, visibility arbitration, and repeated name-prefix trimming.
- 4caaa56 art isolation accepted. Unset/off uses placeholder models and lights; the new resolved-order staff celebration is intentionally shared. Isolated scene checks pass with art off and on, including real art-unit and art-light assertions, picking, workflow roles/links, handoff, door placement and portal lifecycle. A frozen archived build rendered in independent Chrome with no page errors; temporary art-on.png was visually inspected. This early image predates the final A3 world/FX changes.
- 5f922e8 label checks pass zoom threshold, selected/hovered title replacement, and readable learning/component slug labels. cd4c8ba later shortens handoff text to one clause/eight words and increases name sizes; reviewed source, final A3 visual check pending.
- 74466f8 had a P2: an already-resolved snapshot target stayed in art state open. Reported to scene and lead. a727e52 verifies fixed: both snapshot and live resolution now end in art state resolved; snapshot does not call live defeat. Also reviewed building disposal hooks and optional art-only richer FX fallbacks.
- cdd1e5e world wiring reviewed: shared gate positions, blocked camps/unit tiles/Library plaza/door rows, label retention and layout disposal. Full A3 live acceptance is still in progress, not declared by this checkpoint.
- 2bfea57 Loadout accepted in isolation: changed-fields PATCH, catalog toggles, applying/applied state, stale-unit response guards and three-way dirty merging pass. Additional checks pass same-view edits during Apply, failed Apply retaining draft/error, Revert to accepted state, and removal of the store listener on disposal. Latest completed suite: 17 tests / 103 assertions. a194cfc locks GBrain on per the Analyst decision; source and new regression reviewed, next suite run pending.
- 6731d73 demo-snapshot.sh: reviewed archive/build-before-stop, loopback preview, engine proxy config, and exact PID/command stop guard. Shell syntax and an isolated archived board build pass. Did not start/stop or replace the shared 4621 preview. Concurrent invocations and occupied-port failure behavior were not exercised.
- Working-tree typecheck briefly failed only at the in-progress look HUD bottomPanel.ts comparison of barracks and gbrain. Do not interpret the earlier clean build as validation of those later uncommitted edits.

## Urgent Form team live click-through on 4619

- PASS after coordinating mock-engine quiet time. Selected mixed u4/u5/u6, clicked Form team, observed POST /api/teams 200 and exact team 4. Eight preset cards appeared. Clicked Trio and observed PUT 200. Armed planner, clicked Eno's bench portrait, observed full-graph PUT 200 and bindings u5/u4/u6. A real mouse right-click on camp t108 sent {teamId:4,targetId:t108}; HTTP 200 returned running run w1, active planner, order o2.
- pageerrors=[] and the art-on scene was ready. Earlier attempt got API 200 but a concurrent engine redeploy/reset removed the new team before the assertion. Engine lead confirmed automatic redeploys plus test resets caused those flips, and provided /tmp/engplan/with4618 for future live checks.
- A separate 15-second scene-readiness timeout under high machine/software-render load did not recur in the successful full flow. Diagnostic console contained test-induced blocked Vite WebSocket messages and one resource 404; no caught scene mount exception was captured. Remaining A3 checks remove that interception and hold the engine test lock. No request was sent to 4610/4611.

## A3 UI gate: PASS, art on and placeholder fallback

- Completed on live 4619/4618, with the engine test lock for the final pass. No real-QM requests. The initial hardware-independent checks used software WebGL; this final run used Chrome ANGLE Metal on Apple M4 Max at 1512x982.
- Art on: real mouse unit/camp/building picking, selected unit/camp rings, Forge opening, drag-box selection, Train Smoke Ranger from an existing dry-run type, selecting the new forged u7, and an actual camp order with authoritative position movement all pass. No Forge type was created or trained by the reviewer.
- Workflow: full Form team/Trio/role swap/order flow passed earlier; final art pass also starts a real mock trio run and verifies three role badges and three run links. Explicitly resolved the test team from current membership instead of assuming team 1 remained intact across other tests.
- Concurrent recall on u1/u2 plus remember on u3 creates visible effects. Inspected art-gate-fx.png: blue narrow beams, readable surrounding units and no broad white wedge. Includes 7eb50a6 and 28d6c15 FX tuning, 9a243cc portal, c1f21f8 contact shadows, bc80e40 banner glow, cdd1e5e world wiring, cd4c8ba labels and a727e52 scene fixes.
- Frame sample: 61 FPS, 436 draw calls, ANGLE Metal Renderer: Apple M4 Max. This is a short loaded-machine sample, not a sustained benchmark. No JavaScript page errors or shader exceptions.
- Network caveat reported to UI lead: Forge detail fetches for refund-ranger-2 and rule-warden evaluation records returned 404 in the first pass, plus a missing resource 404. The panel remained usable and showed scores on the later fallback capture. Do not claim an entirely empty browser console.
- ?art=off: placeholder unit/camp picks and Forge opening pass; screenshot art-off-fallback.png inspected. Both screenshots are temporary under /tmp/raid-ui-review. Both browser scripts ended and closed their browsers.
- PASS sent to Analyst, raid-art-plan, raid-look-dir and raid-ui-scene. Reviewer did not change demo defaults; the Analyst still requires art reviewer and visual director acceptance.
- a194cfc GBrain lock passes the regression (checked, disabled, no phantom dirty state, plugins PATCH retains gbrain). Latest board validation: 20 tests / 119 assertions, typecheck and production build pass (71 modules, nonblocking chunk-size warning).

## Orders bar polish: 54b37bb

- Accepted with no new actionable finding. Focused checks pass structured proposal title and full tooltip, stable children on unchanged state, icon aria labels, Adjust command toggle, run's reached-node fallback after team workflow removal, terminal status pill with stable sub-line, and CommandHint naming the pending implementer role.
- Existing run-card tests still pass current-order cancellation, current-member selection, 8-second live/loaded completion expiry, 5-minute alert expiry and dismissal persistence. Board smoke: 20 tests / 119 assertions and typecheck pass. No browser launched for this small DOM change.
- Post-capture cleanup read showed every unit idle with no order and no running workflow; the earlier review trio was absent. No cancellation was issued. Capture-hold wrapper completed and released its lock. All reviewer browsers and mutation scripts are closed.
