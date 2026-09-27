# Engineering review log

Owner: raid-eng-rev. Scope: review engine, mock-bridge, and autopilot commits; run their smoke tests; report actionable bugs to implementers and blockers to raid-eng-plan. Implementation files stay with their owners.

## 2026-09-27 14:46 PDT: review setup

- Read `docs/COMMON.md`, `docs/PLAN.md`, `docs/CONTRACT.md`, `contract/types.ts`, and `docs/lanes/eng.md` at baseline `9f0705c`.
- No service implementations or service smoke tests exist yet. No implementation review or milestone pass is claimed.
- Asked Analyst to reconcile issue and timestamp examples with shared types. Resolved by contract update `95dfb02`: `contract/types.ts` is authoritative, issue IDs are strings, and all timestamps are epoch milliseconds.
- Contacted raid-eng-plan, raid-eng-impl, and raid-eng-mock in Herdr's default session for commit SHAs and smoke coordination.
- Read contract v3 `75dc182`: order dispatch carries IDs, terminal bridge events are correlated with the current order, brain page lookup uses `?slug=`, and customer references use IDs with shared World/Customer types and slug conventions.

## M1 acceptance checklist

- Engine binds `127.0.0.1:4610`; `/health` matches the service contract; `/api/state` contains all required shared-type fields and fixture fallback when brain is unavailable.
- `/api/events` starts with `state.snapshot`; every event has increasing `seq` and epoch-millisecond `ts`; subscriber disconnects do not crash the service.
- `/api/orders` validates requested units and targets; creates one order per selected unit; moves tile by tile near 3 tiles/second; sends to bridge on arrival; completes the current order on final reply.
- Bridge failure does not crash engine or leave rejected requests reporting false success. Order sends carry `orderId`, `targetId`, and `componentId`. Late replies/errors for a cancelled or superseded order must not complete or fail the current order; terminal errors fail the matching order.
- Mock bridge binds `127.0.0.1:4615`; implements spawn/send/update/delete/events/health; emits thinking, GBrain read and write tools, activity, and final reply in the specified 6 to 10 seconds.
- Mock units have independent event lifecycles; deleted units do not keep emitting events; invalid JSON and unknown unit requests produce controlled failures.
- Each service has its own package, README, `bun run dev`, and smoke test. No cross-service imports, credentials, real data, or non-loopback binds.

## Later milestone checks

- M2: real brain world, tool-to-memory event mapping, useful issue context, fallback only for orders without GBrain calls, and configurable QM bridge. Library graph/search/page/stats proxies pass through brain responses, including `/api/brain/page?slug=components%2Fbilling` and encoded search queries. Only brain service accesses the game DB; engine uses HTTP.
- M3: consistent team membership, team orders, idle/open proposer filtering, same-component history and distance preferences, 15-second veto lifecycle, exactly one veto log row per resolution, and Forge routing.
- M4/M5: class-to-model spawning, usage totals, dependency degradation, reset with in-flight work, and two consecutive successful demo runs.

## Review record format

Each reviewed commit records its SHA, tests and result, concrete findings (severity, file/line, reproduction, impact), recipients, and follow-up resolution. Unrun tests and environmental limitations are stated explicitly.

## 2026-09-27 14:51 PDT: mock-bridge 79fa5ea

- Read the full commit and `code/mock-bridge`. Confirmed the existing process PID 60564 listens only on `127.0.0.1:4615`; did not start or stop it.
- Ran `cd services/mock-bridge && bun test/smoke.ts`: all 18 checks passed at default speed, including an 8.5-second reply, recall/remember sequence, order correlation, deletion, supersession, isolation, and request errors.
- **P1, resolved by 19535a8: issue-bearing chat silently cancels an active order.** `services/mock-bridge/src/script.ts:53` treats text mentioning an issue ID as an order even without `orderId`; `src/index.ts:78` then clears the current order's timers. Reproduction: send an order with `orderId: "review-active"`, wait 300 ms, then send `{text: "What is the status of LUM-12?"}`. Debug state immediately becomes `orderId: null`; after 11 seconds only an uncorrelated reply exists and the original order never terminates. Engine's required correlation check will leave that order active indefinitely. Select the order/chat path using explicit order metadata and retain text parsing for context; add concurrent chat coverage.
- Sent the finding to raid-eng-mock and copied raid-eng-plan. Synthetic review unit deleted after the probe. No implementation files changed.
- Contract additions reviewed: proposer history is `{targetId, component}[]`, memory is joined summaries, and engine SSE uses shared `EngineEvent` with `forge.updated {unitType}`.

## 2026-09-27 14:53 PDT: autopilot 3cc69f4 and mock fix 19535a8

- Read both commits and `code/autopilot`. Autopilot PID 71737 listens only on `127.0.0.1:4613`; `cd services/autopilot && bun test/smoke.ts` passed all 10 checks. No actionable findings.
- Mock fix selects order versus chat only from a nonempty string `orderId` and keeps text parsing for context. Added concurrent issue-bearing chat regression and world rule slugs.
- Reran mock smoke against replacement PID 83670: all 19 checks passed, order reply after 8.3 seconds, both chat and original order replies arrived. Original mock P1 resolved. Reviewer started/stopped neither service.

## 2026-09-27 14:54 PDT: engine 5be2216

- Read the commit and `code/engine`. Verified existing loopback service and health. README and service smoke are pending the next implementation commit.
- A live u6 chat probe was invalidated by an implementer restart; no conclusion relies on it. Reproduced the findings below using exported production game functions with HTTP dependencies stubbed in a separate Bun process; no test server or shared state was modified.
- **P1, resolved by 5b088af: an uncorrelated terminal event completes the current order.** `services/engine/src/game.ts:171` falls back to `sentOrderId` when a reply/error has no `orderId`. After dispatching o1, inject `{type:"reply", unitId:"u1", text:"Reply to a direct message"}`. o1 becomes done with that chat text and its target is resolved. Require explicit current-order ID equality; a pending-chat counter does not enforce the v3 correlation contract.
- **P1, resolved by 5b088af: stale memory activity stops replacement movement.** `services/engine/src/game.ts:261` forwards every GBrain activity into per-order memory handling without checking its order. Dispatch o2, replace it with o3 to a distant target, then deliver o2's `gbrain.recall`. After 1.9 seconds o3 is active, unit is working at (6,4), target is (20,5), and only o1/o2 were dispatched. `memoryAnim` changed moving to recalling and then working, so movement ticks never dispatch o3. Filter stale/orderless activity before changing per-order counters or movement status; preserve chat rendering separately.
- Both findings sent to raid-eng-impl and raid-eng-plan. Codex class-model map update acknowledged; verify after the next commit.

## 2026-09-27 14:57 PDT: engine fixes 5b088af and regressions 7c30e96

- Reviewed both commits, including the new Forge polling module included in 7c30e96 (not yet wired; its own smoke pending).
- `cd services/engine && bun test/smoke.ts` passed on existing PID 12982: 4 components, 6 units, 9 targets, mock backend, snapshot first, malformed requests rejected, tile movement, working, o3 completed with reply, 12 activity events, increasing seq.
- Reran isolated production-module probes: orderless reply/error leave the active order unchanged; stale and chat memory events preserve movement on the replacement order. Both original engine P1s resolved.
- `cd services/engine && bun test` at 7c30e96: 4 passed, 0 failed, 17 assertions. Covers terminal correlation, stale activity, idle chat animation, and GBrain tool classification. Codex models and fixture IDs now align with the updated contract and world.
- **P1, ID collision resolved by 5fb3eb5 (E14 reset hardening): reset reuses order IDs while old bridge work survives.** `services/engine/src/game.ts` resets `nextOrder` to 1 in `loadWorld`, while `resetWorld` retains sessions and does not stop bridge scripts. Isolated reproduction: dispatch o1, reset, create a new order for t102 (also o1), deliver the pre-reset `{type:"reply",unitId:"u1",orderId:"o1"}`. The new order becomes done with the old reply before reaching its target. Keep IDs unique across resets and stop old bridge work. Sent to implementer and lead; full bridge/brain reset remains E14 work.
- R2 remains scheduled for 15:00. After reporting R2 done to lead and implementer, shared engine switches to QM for M2; do not change mock configuration during that window.

## 2026-09-27 14:59 PDT: mock d23bb44 and engine 5fb3eb5

- Read d23bb44. First mock smoke run passed 23 checks but failed the final saved-config comparison; service log and lead confirmed an overlapping noGbrain toggle. Coordinated a stable window and reran: all 24 checks passed, 7.1-second reply, config restored. Includes MCP names, no-GBrain mode, explicit terminal failure, and engine-assigned learning slug.
- Read 5fb3eb5. Monotonic order IDs survive reset. `bun test` passed 6 tests with 20 assertions, including stale pre-reset reply and nested MCP args. Original reset collision finding resolved; full E14 reset behavior remains pending.
- Compared graph, stats, search with query, and page with URL-encoded slug directly against the engine proxies: all four returned HTTP 200 and identical bodies. An initial connection refusal from brain was transient, so no dependency-down result is claimed from that attempt.
- **Forge review test update resolved by 2cbe733:** Analyst requires `dryRun: true` on every review-created type. `services/engine/test/forge-smoke.ts` in 5fb3eb5 omitted it, and `src/forge.ts` dropped that field when proxying. Sent both changes to raid-eng-mock (module owner), informed raid-eng-impl. Did not run the Forge-creating smoke.

## 2026-09-27 15:01 PDT: M1 R2 independent integration acceptance

- PASS on existing engine PID 23582, mock-bridge PID 12912, autopilot PID 71737. All listen on loopback; reviewer started/stopped no services and changed no mock config.
- Verified all three health responses; 4 components, 6 Codex-model units, 9 targets, mock backend; live state yielded 5 proposer assignments.
- Opened SSE first, verified state.snapshot, ordered u1 to t105. Order o5 completed in 12.0 seconds with 17 single-tile moves, 46 increasing-seq/epoch-ms events, working status, recall before remember, final reply, unit idle, and target resolved.
- Sent R2 done to raid-eng-plan and raid-eng-impl and M1 acceptance to Analyst. Shared engine was then switched to real QM by the implementer. Further reviewer probes remain isolated.

## 2026-09-27 15:02 PDT: 2cbe733, 547832d, 3fea5e3

- Reviewed Forge dryRun handling, autopilot loop/veto resolution, Forge wiring and full reset changes. `cd services/engine && bun test` passed 7 tests, 37 assertions, including go/adjust/cancel/expiry log rows.
- Forge `bun test/forge-smoke.ts` passed in its new read-only default: 7 existing types merged, change-only events, lookup, and unavailable-Forge handling. Port 4699 was unbound before the negative test; no server was opened there. No Forge types created. dryRun forwarding is present and `--create` sends true.
- **P2, resolved by 1566fff: a delayed proposer response can reserve an already engaged target.** `services/engine/src/game.ts:695` checks a `taken` set captured before awaiting `/propose`, and checks only current resolved status. Isolated reproduction: hold the proposer response; create a user order u4 -> t101; release a proposal u1 -> t101. Both the user active order and autopilot proposed order now target t101, despite t101 being engaged. Recompute reservations after the response and require the target still be open. Sent to raid-eng-impl and lead. No shared QM state or mock configuration changed.

## 2026-09-27 15:06 PDT: review queue and test isolation

- Read f0eecf4 (idle status event), 942a896 (plain query-to-component slugs), 1566fff (live target reservation recheck), and bd74090 (mock remember mirror and team/spawn tests). Latest isolated engine suite: 11 tests pass, 52 assertions. Gated proposer regression confirms the P2 fix. No new actionable findings in those changes.
- Read a1e8523: autopilot memory reasons distinguish rules/learnings from bare component mentions. Existing service PID 6992 binds loopback; smoke passed all 13 checks.
- Read cacd7c4 and validated both demo waves with pure script generation, including MCP aliases and exact prior-learning slug. Found a P2 smoke flake: wave 2 inherited a 25% MCP-name probability while assertions recognized only dot names. Reported to raid-eng-mock; bc09c57 forces deterministic names and accepts aliases. Live smoke after the lead released the QM window passed all 26 checks, 9.1-second main reply, both demo waves verified, config restored. P2 resolved.
- Analyst added test engine 4618 and test board 4619. Automated reviewer engine requests now target 4618/mock; 4610 remains reserved for real-QM milestone checks and the demo. No reviewer test requests start paid QM work. At first check 4618 was not listening; requested test-engine ownership/status from implementer while continuing isolated checks.

## 2026-09-27 15:08 PDT: R4 veto acceptance and reset/SSE reviews

- `ENGINE_URL=http://127.0.0.1:4618 bun test/smoke.ts` passed on lead-owned PID 17528: movement, 12 activities, correlated final reply, and snapshot/seq checks. Test engine watches the shared tree; reviewer starts/stops no services.
- Reviewed a8703bb (BRAIN_RESET option and pre-reset guards), b9547cb (exact reset state), c24c2d6 (bounded unread SSE queue). Latest isolated suite passed 13 tests / 67 assertions. Read-only HTTP probe on 4618 confirmed the new SSE endpoint still returns state.snapshot first, numeric seq/ts, mock backend.
- Lead verified `BRAIN_RESET=0` on 4618 and authorized reset. Never reset 4610. The 4618 reset preserves shared game brain data.
- R4 live PASS in the lead's reserved test window: team proposals had 15-second deadlines; cancel, go, adjust, and actual expiry each produced exactly one new row in `/tmp/engplan/vetoes-test.jsonl`, with correct proposal/context/adjustedTo. Expiry activated 135 ms after its deadline; total probe time 20.3 seconds. Test engine reset afterward. Sent R4 done to lead and mock owner; window released for soak/demo.
- **P1, resolved by 2cd8391: a retired/cancelled unit can dispatch after a slow spawn finishes.** `services/engine/src/game.ts` `dispatchOrder` awaits `ensureSpawned` and then sends without checking that the unit and active order are still current. Isolated reproduction: create o1 on adjacent u1; hold bridge POST /units; tick; retire u1; resolve spawn. The unit is absent and o1 cancelled, yet POST /units/u1/send runs with o1. Revalidate after asynchronous spawn/retry and clean up a late spawned session for a retired unit. Reported to implementer and lead; no live or paid work triggered by the probe.
- Lead's origin/content-type restriction finding is queued for verification when its fix lands. New coordination rule: wrap every live 4618 test in `/tmp/engplan/with4618 raid-eng-rev <command>`.


## 2026-09-27 15:14 PDT: dispatch and browser-origin fixes 2cd8391

- Reviewed 2cd8391, including extracted HTTP routes, configured browser origins, delayed registration cleanup, and current-order checks before dispatch/retry. Isolated engine suite passed 17 tests / 85 assertions, including retirement, cancellation and reset during a gated registration.
- Independent gated 404 retry probe passed: retire the unit during re-registration, then release the response. Only the original failed send exists; no retry send occurs, the order remains cancelled, and the late session receives a second DELETE. Original dispatch P1 resolved.
- Ran 14 live HTTP checks on lead-owned 4618 under `/tmp/engplan/with4618 raid-eng-rev`. All passed: allowed board/test-board origins receive matching CORS headers; foreign and opaque origins receive 403 on writes; foreign reads/preflights expose no CORS header; non-JSON bodies receive 415; invalid JSON receives 400; CLI requests without Origin and bodyless allowed-board commands reach normal validation. Unit/order counts unchanged. Lock released on exit; no shared QM requests or mock config changes.
- Lead's origin/content-type P2 resolved. No new actionable finding in this commit.

## Team workflow review queue (W1/W2)

- Read `docs/lanes/flow.md`, the Team workflows contract, authoritative types, and lead interface plan 6fb2a25. Flagged the missing workflow order source to Analyst; dd9fc9f adds `source: "workflow"`, `runId`, and `nodeId`. Lead notified that the new PUT workflow route also needs PUT in CORS allowed methods.
- R5 on locked 4618: team 1 trio runs planner -> implementer -> reviewer changes -> implementer -> reviewer approved, five correlated workflow orders, correct handoff units/context, final run done and target resolved only at completion.
- Module/wiring review priorities: custom graph validation and member binding, branch joins across iterations, bounded changes loops and needs_human, cancellation/reset/retirement while a step is active, failed step handling, latest replies in prompts, and complete shared-type SSE payloads. Implementers own code/tests; reviewer records evidence here.
- W2 real QM remains lead-coordinated on 4610/4611. Automated workflow probes use 4618/mock with the same lock and BRAIN_RESET=0 constraints.


## 2026-09-27 15:19 PDT: F2 workflow wiring 1fa90b7 and fake-flow coverage 9051979

- Reviewed both commits, including dynamic runner loading, linked game hooks, workflow prompt context, terminal notifications, run-wide cancellation, PUT/DELETE routes, default state fields, and exclusion of workflow teams from autopilot (including response-time revalidation).
- Isolated engine suite passed 18 tests / 106 assertions. The fake-flow test verifies workflow source/runId/nodeId, a single entry order, previous reply in the next prompt, target remaining engaged during handoff, cancellation through the runner, autopilot exclusion, and clearing a graph when a bound member leaves.
- Seven independent in-process route/state checks passed: new default fields, PUT in allowed preflight methods, foreign PUT 403, text/plain PUT 415, unknown team 404, explicit unavailable-runner error, and DELETE clearing.
- Existing live engine smoke passed under `/tmp/engplan/with4618 raid-eng-rev` on 4618: snapshot first, validation, movement, working state, completed mock order o1 with reply, 12 activity events, increasing seq. Lock released; no services started/stopped and no request to 4610.
- No actionable finding in the F2 wiring. The graph runner was still absent during these checks; this is wiring/regression evidence, not R5 acceptance. Actual trio loop, fanout joins, bounded loops and integrated cancellation/reset remain pending raid-eng-flow's implementation.


## 2026-09-27 15:25 PDT: workflow runner b6113f2, K12 5da9769, reconnect 74ff066

- Read b6113f2 graph runner and tests: standalone graph suite passes 14 tests / 98 assertions. Combined suite with the bridge reconnect regression passes 33 tests / 210 assertions. Read 74ff066; idle units re-register and refresh their links on reconnect while active units retain lazy recovery. No actionable reconnect finding.
- Independent production-module integration (real workflow.ts plus game.ts, HTTP stubbed) passed the five-step trio loop: workflow source/runId/nodeId, each role and latest reply in its bridge prompt, target engaged until final review, then resolved; four handoffs in the correct direction.
- Read 5da9769 role parsing and scripts. Locked live mock smoke passes all 31 checks, main reply at 7.6 seconds, planner/reviewer/implementer behavior verified, config restored. No actionable K12 finding.
- Read 9cd5eae live workflow test. R5 is queued under the 4618 lock behind raid-eng-flow; no independent live R5 pass claimed yet. Lead restarted 4618 as PID 68005 so the previously missing workflow.ts is loaded; mock PID 64626 has K12. A later game.ts watch reload at 15:23:29 may have invalidated the other owner's in-flight run; owner notified. Implementer holds further source saves for R5.
- **P1, resolved by 89217fb: workflow dispatch continues while reset waits for the brain.** In `services/engine/src/game.ts` `resetWorld`, old orders/runs remain live until the awaited brain reset and bridge deletes finish. Isolated gated reproduction: dispatch trio planner o1, hold POST brain /reset, call resetWorld, deliver o1's reply, tick. Run remains running and implementer o2 is dispatched while reset is still pending. This can start another paid QM turn after Reset was requested. Invalidate/cancel existing runs/orders before the first await and prevent dispatch during reset. Sent to raid-eng-impl and lead; implementer acknowledged and is adding a gated regression.
- **P2, resolved by d363b00: fanout handoff precedes its join.** `services/engine/src/workflow.ts` emits each outgoing handoff before pump checks whether the destination can start. With planner -> u2/u3 -> reviewer u4, finish only u2: a u2 -> u4 handoff is emitted while run.active is implementer2 and u4 has no order. The fixed interface says the event accompanies starting the next node; defer it until the join starts and retain contributor context. Sent to raid-eng-flow and lead.
- **P2, resolved by d363b00: reply history cap drops completed branch results.** `startNode` uses `c.done.slice(-8)` although valid graphs may have 12 nodes. An 11-member fanout completes planner u1 and implementers u2..u10, but reviewer u11 receives only u3..u10, losing the plan and u2's output. Preserve the latest result from each contributing node before limiting older history. Isolated reproduction sent to raid-eng-flow and lead.


## 2026-09-27 15:29 PDT: live R5 scheduling and new-issue review queue

- The R5 wrapper exited after waiting five minutes for raid-eng-flow's 4618 lock (owner timestamp 15:23:18). It never acquired the lock and made no reviewer R5 requests. This is a scheduling limitation, not a workflow test failure. Asked lead for a fresh stable window and released implementer's source-save hold so the reset P1 fix can proceed. Never removed another agent's lock or stopped their process.
- 25595b5 Forge disappearance handling is read; read-only/fake-Forge smoke remains queued after R5, as requested. No Forge type creation is needed.
- Read the new-issue contract and lane ownership. Review queue: POST /api/targets defaults/random pool, unique issue/target IDs under concurrency and shared-brain instances, placement on a free component-zone tile, brain issue links, dependency-down fallback, target.spawned shared event fields, and reset behavior. Lead notified about cross-instance ID allocation (4610 and 4618 share the brain). Due 16:05 on 4619/4618.


## Expanded presets and deployment coordination

- Read contract/types update 71e077f: eight presets plus custom. Review queue includes all eight PUT routes, minimum member counts and member-order binding, role instructions in actual bridge prompts, and valid shared workflow events.
- Recon: scout investigates without fixing, then implementer/reviewer with changes loop. Testfirst: tester supplies a failing regression/acceptance check before implementation. Herald: approval starts the customer-update node; changes return to implementation; the target resolves only after herald completion. A Forge unit is recommended, not required; review uses an existing ready type if Forge routing needs proof and never starts real training.
- Duel: both implementers active before either finishes; judge waits for both replies, picks a named winner on approval, and changes restarts both branches. Flagged the single `Workflow.entry` representation to Analyst for an explicit parallel-entry rule or shared-type extension. Reminded implementer to expand game.ts PUT preset allowlist.
- Lead clarification: brain allocates issue IDs; engine never sends `issue`. K13 targets.ts belongs to raid-eng-mock. This supersedes earlier engine-side allocation notes.
- Lead is coordinating termination of flow's hung live test and replacing watched 4618 with a deployment of committed code, redeployed on engine commits. Wait for the lead's `deployed <sha>` before R5; reviewer will not touch the held lock or the other owner's process.

- Analyst resolved parallel starts: authoritative Workflow now has optional `entries: string[]`; every listed entry starts at once, with `entry` retaining the first ID for older readers. Duel uses both implementer IDs. Review will include absent-field compatibility, valid/duplicate/unknown entries, two immediate orders, and joining/cancelling both branches.


## 2026-09-27 15:41 PDT: R5 acceptance and queued reviews

- R5 live PASS on committed deployment d363b00 under the new `/tmp/engplan/with4618` lock: pinned trio check at mock speed 1 completed in 41.5 seconds. Five done workflow orders, one changes loop, four exact handoffs, target resolved only after final review, run retained in state, DELETE clears the preset. Saved mock configuration restored (speed 4), engine-only reset cleanup passed, lock released. Sent R5 done to lead, implementer and flow owner; Forge completion also releases mock owner's restart window. No request to real-QM 4610.
- Reviewed 89217fb reset invalidation before the first await, reset write/tick gates, message 404 retry, legal spawn tiles and delegated preset allowlist. Gated real-trio regression resolves the reset-dispatch P1.
- **P2, found and resolved by f6e6f36: delayed brain fallback writes after reset.** Independently held an old order's brain recall response, completed reset, then released recall: old code appended recall/remember to the fresh memory and POSTed the old reply to /remember. f6e6f36 checks reset/live identity after each await and prevents stale mirror page refresh. The gated regression passes. Reported to implementer and lead; all dependencies were stubbed and no shared brain was modified by the reproduction. Corrected SHA is f6e6f36, not the earlier mistyped 89217fb.
- Reviewed d363b00: handoffs are delayed until successful destination start, latest reply of each completed node survives history truncation, entries allow parallel starts, and recon/testfirst/herald/duel graphs and role instructions are added. Both fanout P2 regressions pass; no new actionable finding. Expanded preset live checks await the mock role restart.
- Reviewed bb907a6 targets.ts and f6e6f36 route wiring: 15 target tests / 195 assertions pass. Brain allocates IDs, random omits title, form defaults/validation are enforced, tiles reserved before await, dependency failure returns 503 without creating a local target, reset avoids duplicate insertion. No actionable finding. Live shared-brain creation checks remain pending.
- Combined engine suite after f6e6f36 and d363b00 passed 61 tests / 515 assertions. This includes 21 workflow tests and the target route tests.
- Reviewed 25595b5 Forge disappearance behavior. Default read-only `bun services/engine/test/forge-smoke.ts` passed all 16 checks, including dead dependency and an ephemeral fake Forge: removed unused types disappear once, used types remain failed until their final unit is gone, unchanged polls emit nothing. No Forge types created; no actionable finding.
- Next reviews: ada1c92 engine Loadout, 592f74d mock Loadout, 0bf31aa mock roles, 127a76f soak, 6ac9b33 persistence and d46e345 Loadout wiring. Test engine uses committed deployments under the lock, STATE_FILE=0 and BRAIN_RESET=0. Never restart/reset 4610 for automated review.


## 2026-09-27 15:57 PDT: expanded presets R6, Loadout and restart reviews

- R6 live PASS under the lock on deployment 5d6f1ed and shared mock 592f74d. Recon 13.5 s, testfirst 6.3 s, herald 5.7 s, duel 11.4 s at speed 8. Each takes one changes loop; five done workflow orders/four handoffs, or six/six for duel. Both duel entries start immediately and both judgments follow both branch completions. Correct prep replies, final customer update and named duel winner; targets resolve after the last order. SSE seq increases and timestamps are epoch milliseconds. Full mock config restored to saved speed 4 and engine-only reset cleanup passed. Lock released; lead/flow/mock notified.
- Reviewed 0bf31aa new mock roles, 592f74d mock Loadout, and 3e0c6ad smoke speed discovery. Locked smoke passed all 39 checks against the old 592f74d runtime, including its then-current optional-GBrain behavior. Analyst subsequently requires GBrain always on; normalization and revised checks are pending their owner. Engine catalog and ordinary instructions/skills/model/effort PATCH also passed live during R6.
- Reviewed 676c77b forgeEval and 5d6f1ed route. Read-only Forge smoke passed 29 checks: live polling, dead dependency, unchanged eval passthrough, mock-labelled synthetic eval on the mock backend, and real-QM-backend 404 preservation against an ephemeral fake Forge. No Forge type creation or QM bridge requests. No actionable finding.
- Reviewed 450ba34 brain-409 handling: random spawn tries the next least busy component and its free tile; explicit component/title preserves refusal; exhaustion returns 409. All 17 target tests pass. No actionable finding.
- Reviewed 6ac9b33 persistence, b22dfa2 workflow context save/load, a508713 live-test race fix, and 5d6f1ed real workflow restore regression. State file is atomic, age/backend gated and disabled on 4618; graph context keeps pending joins, arrivals and replies. Independent suite includes restoration of walking/sent/proposed orders and an actual trio handoff after JSON restoration. No actionable finding. Actual real-QM process kill/restart remains the lead's coordinated check; reviewer did not touch 4610. QM bridge devbrain page confirms terminal backlog replay while the engine is disconnected.
- Reviewed ada1c92 engine Loadout and d46e345 wiring. **P2, basic path resolved by c7e082a + 81d4c6a: idle reconnect loses custom loadout.** Fake bridge restart followed by resync originally produced no loadout PATCH: engine still displayed custom instructions/skills/plugins while bridge had defaults. New registration now reapplies it; independent probe confirms one PATCH and identical bridge/engine loadout.
- **P2, basic path resolved by c7e082a + 81d4c6a: Loadout PATCH404 retries without registration.** Previously registered unit forgotten by the fake bridge received two PATCH404 calls and no POST /units. New reRegister callback forces POST and the next full-loadout PATCH succeeds. Independent probe passes. Both basic findings sent to impl/mock and lead.
- **P2, resolved by c2109e8: sends can overtake the restoring loadout PATCH.** In 81d4c6a ensureSpawned sets spawned=true before awaiting reapplyLoadout; another caller returns from the spawned check instead of waiting on spawning. Gate the resync's restoring PATCH, create an adjacent order and tick: POST /units/u1/send occurs while that PATCH remains pending. Prioritize the in-flight registration promise and test dispatch waits. Isolated reproduction `/tmp/raid-eng-rev-loadout-race.ts` sent to impl and lead.
- **P2, resolved by 573f8fa: effort/model-only PATCH404 drops the saved loadout.** c7e082a retries the original request unchanged. With saved custom instructions/debug/github and a forgotten bridge unit, an effort-only PATCH leads to PATCH effort, POST /units, PATCH effort and success, while the bridge loadout remains default. The forced registration deliberately skips old-loadout restoration, so the retry must include the full merged loadout even when the input only changes effort/model. Same isolated reproduction sent to mock and lead.
- Latest single engine suite after 81d4c6a: 85 tests / 657 assertions pass. No parallel suites or watcher loops started. Analyst's machine resource clamp acknowledged; no browser or persistent reviewer process exists.
- Reviewed 127a76f soak source. **P2, resolved by 573f8fa: extra veto log rows do not fail exactly-once validation.** The multiset consumes expected rows but only prints leftovers as possible other clients; under the exclusive lock a duplicate row can still yield PASS. Sent to mock to make extras fail by default. The owner's three-minute result is reported as 56/56 rows with five resets; reviewer has not rerun the soak under the resource clamp.


## 2026-09-27 16:01 PDT: Loadout recovery findings closed

- Reviewed 573f8fa and c2109e8. Focused Loadout suite passes 18 tests / 85 assertions; both game-level Loadout P2 regressions pass (13 assertions). Independent gated probe confirms no send before restoration completes, and effort-only 404 recovery now restores the complete saved instructions/skills/plugins. Both remaining Loadout recovery P2s resolved.
- GBrain normalization is enforced on requested and confirmed loadouts and reapply; catalog always includes the Library hint. Reviewed 3bec325 mock normalization and revised 39-check smoke assertions. Shared mock runtime verification for that new SHA remains queued behind the UI capture lock and the owner's restart; the earlier 39/39 result is specifically 592f74d.
- Soak duplicate-row P2 is resolved in source: extra rows now fail the default exclusive run, while optional --shared explicitly relaxes that condition. No new three-minute run was started under the resource clamp. No open actionable finding remains in the reviewed commits; live normalization and process-restart acceptance are separately scheduled checks.
