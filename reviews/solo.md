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

## 2026-09-27: contract follow-up `95dfb02`, `75dc182`

Reviewed `git show HEAD` at `75dc182b95235d1c769fa4ac305e28ca68dc864e`, `git show 95dfb02`, and both complete contract files. All six initial gaps are addressed at the specification level:

- Send requests carry `orderId`, `targetId`, and `componentId` for orders; shared `SendRequest` added.
- Activity and terminal reply/error events carry `orderId`; stale terminal events are ignored by the engine.
- Engine Library proxy routes are defined; pages use the query parameter `?slug=` to preserve nested slugs.
- Brain is designated the only DB owner, with the MCP design to be agreed with the QM lead before M2. Runtime serialization/ownership remains an implementation acceptance check.
- Issue ids are strings and timestamps are epoch milliseconds throughout.
- Shared `World`/`Customer` types and page slug conventions are defined; `Target.customers` contains customer ids.

**P2 follow-up sent to Analyst:** the state example still uses `customers/acme-robotics` instead of the v3 customer id `acme-robotics` and omits required `unitTypes`. Align those examples so fixtures copied from the contract match the actual schema. This does not reopen the settled schema decisions.

Validation: documentation/type diff inspection only. No submitted service revision or runnable service smoke exists at this point.

## 2026-09-27: Forge M1 `5715cca`

Scope: `5715cca5f23803c96bd39aa93ba0af82548414ec`, all 11 changed files. Inspected `git show` and current files; `git diff 5715cca -- services/forge river` was empty during validation. Service already running on `127.0.0.1:4612`, reported PID 46579; reviewer did not start or stop it. Devbrain lookup `scripts/devbrain get code/forge` returned `page_not_found` at review start.

**P2: forged type ids collide with built-in classes.** `services/forge/src/server.ts:41-45` only checks ids in the Forge map. Executing the committed `slugify` function with an empty map yields `knight`, `ranger`, and `scout` for names Knight, Ranger, and Scout. Those ids already belong to built-in unit types. Since the spawn API accepts only `{class: typeId}`, the engine cannot distinguish these forged types from built-ins and can route the unit to the wrong bridge/model. Prefix forged ids or reserve all built-in ids, while retaining uniqueness for duplicate names. Fix before spawning Forge units.

**P2: the held-out set leaks training prompts.** `river/forge/pipeline.py:56-58` shuffles and splits rows after `datagen.build_prompts` samples with replacement from five fixed templates per issue (`river/forge/datagen.py:83-89`). Reproduced with the committed fallback world, Smoke Ranger description from the smoke test, 160 rows, and seed 7: 23 unique prompts; 128 train rows; 32 evaluation rows; 31 evaluation rows have an identical user prompt in the training set. This invalidates the planned held-out score once real training is enabled. Partition unique prompts or issue groups before sampling, and verify zero prompt overlap across train/evaluation splits.

Both findings sent to `raid-river` in Herdr session `default`. These are follow-up fixes for integration and real evaluation; neither prevents the M1 dry-run stage-machine demonstration. Real River training and Forge Bridge endpoints are later milestones and were not treated as missing M1 implementation.

Validation:

- `cd services/forge && bun run smoke`: PASS, mode `dry`, created `smoke-ranger-2`, observed nonzero generation progress and all required response keys.
- Deterministic in-memory prompt/split reproduction using `river/.venv/bin/python`: confirmed 31/32 evaluation prompt overlap as above; no River API calls.
- Executed the committed `slugify` body using Bun with an empty map: confirmed all three built-in collisions without creating those conflicting types in the running service.
- Full dry-run completion check for `smoke-ranger-2`: PASS, observed training and evaluating, then `ready` with progress 1, 160 examples, `model: dry-run:smoke-ranger-2`, and `evalScore: null`.

## 2026-09-27: Forge fixes `4585f77`

Reviewed `4585f77d76cd84a2ca01510b197a64dd8f2f83b1` with no working-tree differences in Forge/River paths. Both findings from `5715cca` are resolved for newly generated types/data:

- The committed id generator returns `forge-knight`, `forge-ranger`, `forge-scout`, and `forge-oracle`; repeated Knight names produce `forge-knight-2` and `forge-knight-3`.
- The new split returns 128 distinct train prompts and 32 distinct evaluation prompts with zero overlap for both the fallback world and the live nine-target Brain world at seed 7. The pipeline preserves that split when writing JSONL. This establishes held-out phrasing, not held-out issue/generalization evaluation.
- `cd services/forge && bun run smoke`: PASS against the restarted service (reported PID 65749), type `forge-smoke-ranger-2`.
- Full dry-run completion: PASS, `ready`, progress 1, 160 examples, `model: dry-run:forge-smoke-ranger-2`, `evalScore: null`.
- Devbrain `code/forge` is now available and was read.

No new actionable findings in this fix commit. The earlier push of review commit `84aaa1d` raced another agent's push; a subsequent `git ls-remote` confirmed remote main had advanced to descendant `2288e94`, including that review. No pull, force push, or history rewrite was used.

## Lane review queue

- `raid-gbrain`: reviewing `eedbb1a` and `b603566`.
- `raid-river`: `5715cca` reviewed; both P2 findings resolved in `4585f77`.

For each submitted commit: inspect `git show <sha>`, inspect relevant current service files, run the service smoke test, record the tested revision and command/result, and send only concrete actionable findings in severity order. Copy the Analyst on blockers. Do not edit lane code.
