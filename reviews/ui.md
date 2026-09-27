# UI review log

Reviewer: raid-ui-rev. Owner of this file only; implementation fixes go to the path owner.

M1 checkpoint findings are resolved. Current open P1: responsive proposal dock in d62bc78 clips veto controls when cards exceed its height; assigned to raid-ui-hud. Library request race is fixed in 0cbfb2c and Forge chimney coordinates in cc4c7b9. Seven smoke tests, typecheck, build, health, and isolated interaction checks pass. Independent headless Chrome now renders the mock test board at 4619; normal HUD screenshots fit 1200x600 and 1512x790. Hardware GPU performance remains unmeasured.

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
