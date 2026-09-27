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
