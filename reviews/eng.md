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
- **P1, open: a retired/cancelled unit can dispatch after a slow spawn finishes.** `services/engine/src/game.ts` `dispatchOrder` awaits `ensureSpawned` and then sends without checking that the unit and active order are still current. Isolated reproduction: create o1 on adjacent u1; hold bridge POST /units; tick; retire u1; resolve spawn. The unit is absent and o1 cancelled, yet POST /units/u1/send runs with o1. Revalidate after asynchronous spawn/retry and clean up a late spawned session for a retired unit. Reported to implementer and lead; no live or paid work triggered by the probe.
- Lead's origin/content-type restriction finding is queued for verification when its fix lands. New coordination rule: wrap every live 4618 test in `/tmp/engplan/with4618 raid-eng-rev <command>`.
