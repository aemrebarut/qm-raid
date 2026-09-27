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

## 2026-09-27: Lumen world `eedbb1a` and Brain service `b603566`

Reviewed both commit diffs and all new files. Initial service PID reported as 68228. No game-brain CLI command was run; all runtime access used the service HTTP/MCP routes. `scripts/devbrain get code/brain` initially returned `page_not_found`.

- `eedbb1a`: no actionable findings. Validated all 27 seed pages have resolvable wikilinks, all 9 target tiles fall inside their component zones, all buildings fit the 24x24 grid, all 5 customers reference existing contact pages, and target customer ids resolve.
- `b603566`: `cd services/brain && bun run test` PASS (7 checks). Additional MCP initialize, tools/list, recall, remember, and t101 learning recalled for t102 all passed.

**P1: new learning links do not appear during active use.** In `b603566`, `services/brain/src/server.ts:89-108` writes wikilinks and relies on the GBrain sweep; `graph():38-48` caches extracted links indefinitely. Reproduced a new learning node with zero outgoing edges immediately, after 3 seconds, and after another write forced a graph rebuild. The installed dependency source `gbrain/src/commands/serve.ts:53-59` sets a 10-minute idle-check interval and documents extraction after 10-20 minutes of inactivity, contradicting the README's approximately one-second expectation. Active requests postpone the sweep. Fix by deriving graph/recall links from persisted page bodies immediately or explicitly extracting through the owner process; expire graph cache as well. Sent to `raid-gbrain`, copied `analyst`. **Resolved in `7c65a17`, verified below.**

**P2: concurrent add_link loses an acknowledged update.** In `b603566`, `services/brain/src/server.ts:120-126` performs a read-modify-write across separately queued RPCs. Two concurrent MCP add_link requests from the same synthetic review learning to Orchard and Brightpath both returned `ok: true`; a subsequent get_page retained only Brightpath. Serialize the complete mutation per source or globally. Sent to `raid-gbrain`; the test page's lost link was repaired sequentially. **Resolved in `8532e4f`, verified below.**

## 2026-09-27: Brain follow-ups `ae84989`, `4148aea`, `8532e4f`, `6e581d2`, `29fddaf`, `7c65a17`

Inspected each commit diff. Runtime checks used the evolving shared service, with final acceptance on the stable service reported as PID 26357 at `7c65a17`.

- `ae84989`: write smoke passed. Two sequential `POST /reset` calls both restored 27 seed pages; first deleted 6 synthetic learning/unit pages, second deleted 0. Both graphs had 27 nodes, 72 edges, and no learning/unit nodes. No actionable findings in the reset/forget changes. Review-created pages were removed by these resets.
- `4148aea`: graph taxonomy verified through HTTP: product, component, rule, issue, company, and person match the seed slug prefixes. No actionable findings.
- `8532e4f`: the service-level mutation lock covers HTTP and MCP writes. Initial write smoke was interrupted by an owner service restart (socket closed); rerun passed. The concurrent add_link regression confirms both acknowledged links persist. Closes the P2 lost-update finding.
- `6e581d2`: expanded smoke passed for caller-assigned learning slugs. A separate HTTP check wrote twice to the same new learning slug and verified the second body replaced the first; cleanup via /forget passed. No actionable findings for valid engine-generated slugs.
- `29fddaf`: t101 recall includes `people/maya-chen`; verified via HTTP. No actionable findings.
- `7c65a17`: `SMOKE_WRITE=1 bun run test` PASS, including immediate edges from a new learning to its issue/component/unit, parallel add_link persistence, assigned slug, and cleanup. The implementation now scans persisted learning page bodies for recall and unions wikilinks into graph edges; graph cache has a 10-second TTL and write invalidation. Closes the P1 delayed-link finding. Restart survival was inspected in code (no process-local learning index remains); reviewer did not restart the owner's service.

## 2026-09-27: River training `8e2f786`, teacher context `dcce227`, Forge bridge `c8ba93a`

Reviewed all three commit diffs and the installed `river-client` method signatures for training, checkpoint save, sampling, and chat completion. Renderer tokenization checked offline with `HF_HUB_OFFLINE=1`: returned model_input/weights, masked system/user tokens, positive assistant weights, and a sample prompt with stop strings. An initial inspection expected the old input_ids/labels shape and was corrected after checking the renderer and installed SDK; this was a reviewer probe error, not a service defect.

- `8e2f786`: no concrete API-shape finding in LoRA SFT, checkpoint save, paired evaluation, or environment loader. Both models receive identical eval prompts and settings. The rubric measures formatting and identifier coverage; it does not measure issue-resolution quality. Full paid training/evaluation is being run by the lane owner, not validated by this offline check. No credential file was read or printed by the reviewer.
- `dcce227`: offline stage_generate with a fake teacher and synthetic recall context passed: 128 train rows, 32 evaluation rows, zero prompt overlap, all rows have context and nonempty answers, 11 deliberately failed teacher rows fell back to templates. Disabled env loading in this probe; no provider API calls. No actionable finding in this commit.
- `c8ba93a`: `bun run smoke && bun run smoke:bridge` PASS. The bridge smoke used an existing dry-run type. The service changed from dry to river between the reviewer's health check and the requested types smoke, which created `forge-smoke-ranger-3` and reached teacher generation. The lane owner was notified immediately; no further POST /types calls were made. This smoke proves startup/progress only, not completion of real training.

**P1: a direct message silently abandons an active Forge order.** `services/forge/src/units.ts:43-48` increments the unit generation for every send, including direct messages; `:73,86,92` discards an earlier order's completion and skips clearing its orderId. Reproduced in-process with createUnits and a deferred fake model: spawn unit, send order A with valid target/component/order ids, send a direct status message before A's model resolves, then resolve both. Only the direct reply is emitted; GET /units still reports `orderId: review-order-A`, with no terminal reply/error for A. The engine can remain active forever. Serialize or reject direct messages while an order is active, or preserve independent request completion identities. Sent to `raid-river`, copied `analyst`. No River calls were needed to reproduce it.

## 2026-09-27: Brain recall `86cd9dd` and world content `cce3047`

Inspected both diffs. `SMOKE_WRITE=1 bun run test` PASS against the service reported as PID 40789. A separate t101 remember / t102 recall check verified rules precede labelled past learnings, which precede issue context; the stored learning text is capped at 2000 characters. Test learning/unit pages were cleaned with /forget. Rule discovery now reads component wikilinks, removing the sweep dependency after reset. No actionable findings in either Brain commit. Richer issue pages add reproduction steps, code pointers, and completion criteria without changing world identity or layout.

**P2 cross-lane finding on `dcce227`: Forge truncates past-learning content.** `river/forge/datagen.py` `user_message()` slices recall context to 1500 characters. In the live billing t101-to-t102 recall above, the rule appears at index 1147, the `Past learning:` heading at 1416, and the actual learning body at 1522. Consequently the Forge model receives none of the new fact despite a successful recall. Keep past-learning bodies when allocating the context budget, using the same format for training and serving. Sent to `raid-river`; `raid-gbrain` informed. No provider API calls were made for this reproduction.

Operational update: raid-river stopped `forge-smoke-ranger-3` by PID. Forge type-creation review checks must now send `dryRun: true`, per the updated contract. Do not run the Forge smoke until the owner confirms the updated service has restarted. Existing real demo training is owned by raid-river.

## 2026-09-27: River batch `883b0fa`, `1665e13`, `df39407`, `1ccc96e`

Inspected every commit with `git show`. The owner reports the running Forge still uses older code while real demo training completes; live smoke is explicitly deferred until the owner confirms restart. No type was created during this batch review.

- `883b0fa`: all train/eval order templates now include the customer name, matching the eval rubric's customer requirement. No actionable findings.
- `1665e13`: `dryRun: true` is stored per type, excluded from the public type representation, and forces `--dry-run` even in river mode. The types smoke supplies the flag. Static review passes; verification against a running instance awaits the authorized restart.
- `df39407`: verified installed `river-client.Client.session` accepts the explicit end-to-end creation timeout. Added stage/timing fields do not change training/evaluation semantics. No actionable findings; real session timing is being validated by the lane owner's demo run.
- `1ccc96e`: inspected proposer filtering, per-unit/target uniqueness, veto example construction, and weight refitting. Offline `cd services/forge && bun run test:commander`: PASS, 8 veto rows become 12 labelled examples and the scout switches from billing to search. Test uses synthetic data in a temporary directory without the real veto log or provider APIs. No actionable findings.

## 2026-09-27: Brain context-budget fix `1f62436`

Reviewed the diff and ran `SMOKE_WRITE=1 bun run test` against the service reported as PID 75288. PASS, including the regression that a new learning's actual fact text survives `context.slice(0, 1500)`. Recall now leads with condensed persisted learnings and strips their metadata footer before including the component/rules/issue/customer context. This closes the cross-lane P2 from `dcce227` for the demonstrated t101-to-t102 learning flow. No new actionable findings.

## Lane review queue

- `raid-gbrain`: reviewed through `1f62436`; all reported Brain findings resolved.
- `raid-river`: reviewed through batch ending `1ccc96e`; P1 direct-message interruption in `c8ba93a` awaiting fix. Live dryRun/commander checks await owner restart notification. Context truncation resolved by Brain `1f62436`; type-id and train/eval overlap P2 findings resolved in `4585f77`.

For each submitted commit: inspect `git show <sha>`, inspect relevant current service files, run the service smoke test, record the tested revision and command/result, and send only concrete actionable findings in severity order. Copy the Analyst on blockers. Do not edit lane code.
