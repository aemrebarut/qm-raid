# Solo lane reviews

Reviewer: `raid-rev`. Lanes: `raid-gbrain` (`services/brain/`, `world/`) and `raid-river` (`river/`, `services/forge/`).

## 2026-09-27: initial contract review

Baseline: `d045515` (contract and lane definitions), read at repository HEAD `9f0705c`.
Read: `docs/COMMON.md`, `docs/PLAN.md`, `docs/CONTRACT.md`, `contract/types.ts`, `docs/lanes/gbrain.md`, `docs/lanes/river.md`.
Status: findings sent to `analyst` using Herdr, session `default`. Relevant integration risks also sent to both solo leads. No lane commit has been submitted for review yet; no service smoke test exists at this baseline.

1. **P1: provide order context to Forge.** `docs/CONTRACT.md:60` gives bridge send only `{text}`, while Brain recall requires `componentId` and `targetId` at line 73 and remember requires `targetId` at line 74. Forge cannot reliably choose the issue/component for its required memory calls from arbitrary user text. Add a shared send request with optional structured `{orderId, targetId, componentId}` context for orders; direct messages can omit it. Specify how direct messages use memory.
2. **P1: correlate terminal bridge events to their request.** `docs/CONTRACT.md:60-66` and `contract/types.ts:30-33` identify a reply only by unit. Cancel order A, send order B on the same unit, then receive A's late reply: the engine cannot know that the reply must not complete B. Add a request/order identifier to send and echo it on terminal replies/errors, define the terminal failure event, and require the engine to ignore stale completions. Define cancellation handling or require bridges to keep requests serialized until completion.
3. **P1: define the engine routes for Library data.** Board is restricted to engine HTTP calls (`docs/CONTRACT.md:48`), but graph/search/page/stats exist only on Brain (`docs/CONTRACT.md:75-78`). Add `/api/brain/graph`, `/api/brain/search`, `/api/brain/page/...`, and `/api/brain/stats` proxy contracts, including handling nested slugs such as `components/billing`. Otherwise the Library panel must violate service boundaries or invent its own API.
4. **P1: settle shared database ownership before MCP integration.** `docs/CONTRACT.md:54,80` combines a separate `gbrain serve` process with serialized CLI calls in Brain. Serialization inside the HTTP service does not coordinate the separate MCP process against the same single-writer PGLite database. Specify one DB owner and a common queue/interface, for example an MCP facade through Brain or Brain calls through one hosted GBrain process. This is an architectural gap; no running-service failure has been observed yet.
5. **P2: align wire values with shared types.** `docs/CONTRACT.md:13` uses numeric `target.issue` but `contract/types.ts:15` requires a string. `docs/CONTRACT.md:18` uses ISO `memory.recent[].ts` but `contract/types.ts:23` requires a number. Pick canonical representations and update examples/types together; explicitly document epoch milliseconds if numbers are chosen. Event envelope timestamps can remain ISO if deliberately distinct.
6. **P2: specify the World and Customer shapes and page identity.** `docs/CONTRACT.md:72` includes `customers`, but `State` has no customer field and no shared `World` or `Customer` type exists. Add those schemas and define how `targetId`, `target.issue`, and the issue page slug relate. This is needed for engine loading and Forge training/recall without independent ad hoc models.

## Lane review queue

- `raid-gbrain`: awaiting first submitted commit SHA.
- `raid-river`: awaiting first submitted commit SHA.

For each submitted commit: inspect `git show <sha>`, inspect relevant current service files, run the service smoke test, record the tested revision and command/result, and send only concrete actionable findings in severity order. Copy the Analyst on blockers. Do not edit lane code.
