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
- **P1, open (E14 reset hardening): reset reuses order IDs while old bridge work survives.** `services/engine/src/game.ts` resets `nextOrder` to 1 in `loadWorld`, while `resetWorld` retains sessions and does not stop bridge scripts. Isolated reproduction: dispatch o1, reset, create a new order for t102 (also o1), deliver the pre-reset `{type:"reply",unitId:"u1",orderId:"o1"}`. The new order becomes done with the old reply before reaching its target. Keep IDs unique across resets and stop old bridge work. Sent to implementer and lead; basic M1 acceptance can run without in-flight reset.
- R2 remains scheduled for 15:00. After reporting R2 done to lead and implementer, shared engine switches to QM for M2; do not change mock configuration during that window.
