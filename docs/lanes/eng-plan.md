# Team Engine plan (lead: raid-eng-plan)

Owners: raid-eng-impl `services/engine/` · raid-eng-mock `services/mock-bridge/`, `services/autopilot/` · raid-eng-rev `reviews/eng.md` · raid-eng-plan this file, `data/`.
Stack: Bun 1.4.2 + TypeScript, `Bun.serve` (Hono allowed, nothing else heavy). Every service: own `package.json` with `"dev": "bun --watch src/index.ts"`, `README.md`, `GET /health` -> `{"ok":true,"service":"<name>"}`, `test/smoke.ts` (run with `bun test/smoke.ts` against the running service), host `127.0.0.1` only, port from `PORT` env with the contract default.
Types: `import type {...} from "../../../contract/types.ts"` (from `src/`). Never import another service.
Commit after every step that works: `git add -- <your dir> && git commit -m "<agent>: <what>" -- <your dir> && git push origin main`, then `herdr agent prompt raid-eng-rev "review <sha>: <one line>"`.

Contract v3 (commit 75dc182) is in force: `contract/types.ts` is authoritative, timestamps are epoch ms everywhere, issue ids are strings like `LUM-12`, bridge send carries `orderId`, and bridge `activity` / `reply` / `error` carry `orderId`.

## Team decisions (binding inside the team; contract questions go to the Analyst via the lead)
- Event envelope: `{seq, ts: epoch ms, type, ...payload}`; `seq` increments per engine process. SSE: send `state.snapshot` first, then a `: ping` comment every 15 s.
- Times: `order.vetoDeadline`, `MemoryOp.ts` and event `ts` are epoch ms. `target.issue` is a string like `LUM-12`. `target.customers` holds customer ids (brain slug `companies/<id>`).
- Bridge send body: `{text, orderId, targetId, componentId}` for orders, `{text}` for direct messages. Terminal events (`reply`, `error`) whose `orderId` is not the unit's current order are dropped (stale after cancel). `error` -> order `failed`, unit `idle`.
- Movement: one tile step every 333 ms (about 3 tiles/s), step `sign(dx), sign(dy)` (diagonal allowed), stop when Chebyshev distance to the target is <= 1. Emit `unit.moved` per step.
- Order prompt text (mock-bridge parses it, qm-bridge forwards it as is):
  ```
  Order <orderId>: work on issue <issue> "<title>" (<kind>, severity <n>).
  Component: <componentId>
  Customers: <customerId>, <customerId>
  GBrain pages: components/<componentId>, issues/<issue lowercased>, companies/<customerId>
  First recall from GBrain what we know about this component, issue and customers. Do the work. Then remember what you learned in GBrain (one learning page, linked to the component and issue). End with a short reply.
  ```
- GBrain tool classification (robust to MCP name variants like `mcp__gbrain__put_page`, `gbrain_search`): lowercase the tool name; if it contains `gbrain`: contains `link` -> `memory.link`; contains `put`, `remember`, `write`, `capture` or `add_page` -> `memory.remember`; anything else -> `memory.recall`. Slugs from `args.slugs`, `args.slug`, `args.page`, `args.from`/`args.to`, else from `args.query` text.
- Mock gbrain args shape: `gbrain.recall` {query, slugs: [...]}, `gbrain.remember` {slug, text, links: [...]}, `gbrain.add_link` {from, to, linkType}. Slugs follow the contract conventions: `components/<c>`, `issues/lum-12`, `companies/<id>`, `learnings/<issue lowercased>-<unitId>-<epoch ms>`.
- Autopilot history shape (engine -> /propose): `history: [{targetId, component}]`, most recent last, max 10.
- Class to model map (one object, `src/config.ts`): knight -> claude-opus-5-5 / high, ranger -> claude-sonnet-5 / medium, scout -> claude-haiku-4-5-20251001 / low.
- Veto log path: `data/vetoes.jsonl` at repo root (engine resolves `new URL("../../../data/vetoes.jsonl", import.meta.url)`, override `VETO_LOG`). Gitignored.
- Degrade, never crash: bridge, brain, proposer or forge down -> log once per minute, retry every 2 s, keep serving. `process.on("unhandledRejection")` logs.

## M1 (15:05): engine + mock-bridge + autopilot running against each other

raid-eng-impl (services/engine)
- E1. Skeleton on 4610: `/health`, in-memory store (`src/store.ts`: state + `emit(type, payload)` that bumps seq, broadcasts to SSE clients, keeps the last 200 events), `GET /api/state`, `GET /api/events`. Check: `curl -N 127.0.0.1:4610/api/events` prints `state.snapshot` first.
- E2. Seed: `GET $BRAIN_URL/world` (default http://127.0.0.1:4616, 2 s timeout); brain world has no units, so add the 6 default units from the fixture. Fallback `src/fixture.ts`: 4 components (billing, auth, search, notifications; zones not overlapping buildings at library 11,11, barracks 20,20, forge 3,20), 6 units (2 per class, teams 1 and 2), 9 targets inside their zones, teams 1 Red #d64545 and 2 Blue #3b7dd8, builtin `unitTypes`, `backend: "mock"`. Check: `/api/state` has 4/6/9.
- E3. Bridge client (`src/bridge.ts`): on start `POST $BRIDGE_URL/units` for every unit (store `qm.sessionId/sessionUrl`, emit `unit.updated`); re-register lazily before a send if missing; subscribe `GET $BRIDGE_URL/events` with reconnect every 2 s. Map `activity` -> `unit.activity`, `usage` -> stats + `stats` event, `reply` -> finish order (done), `error` -> order failed; drop terminal events for a non-current orderId. Check: engine log shows bridge connected; killing mock-bridge does not crash engine and it reconnects.
- E4. `POST /api/orders` {unitIds? | teamId?, targetId}: per unit cancel its previous active order, create order (`o<n>`, active, source user), unit `moving`, target `engaged`, emit `order.updated`, `target.updated`, `unit.status`. Tick loop moves units; on arrival status `working` and send `{text: prompt, orderId, targetId, componentId}` to the bridge. On `reply`: order `done` with `reply`, unit `idle`, target `resolved`, emit all. Errors -> `{ok:false,error}` (unknown unit or target, 400). Check: with mock-bridge up, an order goes active -> done within 25 s and SSE shows moves, activity and the reply.
- E5. `test/smoke.ts` (health, state counts, SSE snapshot first, one order to done), `README.md`. Commit, ping reviewer and lead.

raid-eng-mock (services/mock-bridge, then services/autopilot)
- K1. mock-bridge on 4615: `/health`, `POST /units` -> `{sessionId: "mock-<id>", sessionUrl: null}`, `PATCH /units/:id`, `DELETE /units/:id`, `GET /events` SSE broadcast (ping comment every 15 s). Check: `curl -N 127.0.0.1:4615/events` stays open.
- K2. `POST /units/:id/send` {text, orderId?, targetId?, componentId?}: take componentId from the body (else the `Component:` line) and the issue from the `issue <ID>` text, then over 6 to 10 s emit, every event carrying `orderId`: thinking, tool `gbrain.recall` {query, slugs: [components/<c>, issues/<issue>, companies/...]}, 2 or 3 messages and non-gbrain tools (`read_file`, `run_tests`, `edit_file`), tool `gbrain.remember` {slug: learnings/<issue>-<unit>-<ms>, text, links}, sometimes `gbrain.add_link`, `usage`, then `reply`. A new send to a busy unit cancels the old script. Env `MOCK_SPEED` (default 1; 5 = five times faster, for tests). Unknown unit on send: auto-register. Check: `test/smoke.ts` registers a unit, sends an order text, sees recall, remember and reply in order.
- K3. autopilot on 4613: `/health`, `POST /propose` per the Proposer API. Heuristic per idle unit, greedy, each target at most once per call: only targets with status open; score = severity * 10 + 6 if the unit's history has the component - Chebyshev distance * 0.5; `reason` in plain words ("severity 3 bug in billing, 4 tiles away, knows billing"). Empty input -> `{proposals: []}`. Check: `test/smoke.ts` with 2 units and 3 targets returns 2 proposals on different targets, the highest severity first.
- K4. READMEs, commit, ping reviewer and lead.

raid-eng-rev
- R1. Create `reviews/eng.md`. Review each commit when pinged (`git show <sha>`), run that service's smoke test, send concrete findings most severe first to the author, copy raid-eng-plan on blockers. Priority checks: binds 127.0.0.1, contract field names and enums exact, no crash when a dependency is down, no secrets, no imports across services.
- R2. M1 end to end at about 15:00: start mock-bridge, autopilot, engine; `curl -s -XPOST 127.0.0.1:4610/api/orders -H 'content-type: application/json' -d '{"unitIds":["u1"],"targetId":"<a target>"}'` and watch `/api/events` until `order.updated` done. Report pass or the first failure to raid-eng-plan.

## M2 (15:25): real memory events and the QM switch
- E6. Order prompt exactly as above. gbrain tool activity -> `memory.recall` {unitId, slugs, summary} / `memory.remember` {unitId, slug, summary} / `memory.link` {from, to, linkType}, with unit status `recalling` / `remembering` for 1.5 s then back to `working`. Keep `memory.recent` (last 20 MemoryOp) and `memory.pages` (brain `GET /stats` at start, every 10 s, and after each remember).
- E7. Fallback: when an order finishes with no gbrain read tool, call brain `POST /recall` {componentId, targetId, unitId} and emit `memory.recall`; with no write tool, `POST /remember` {unitId, targetId, text: reply} and emit `memory.remember`. Brain down -> skip silently.
- E8b. Library proxies: `GET /api/brain/graph`, `/api/brain/search?q=`, `/api/brain/page?slug=`, `/api/brain/stats` pass through to `$BRAIN_URL` unchanged (brain down -> 502 `{ok:false,error}`). raid-ui needs these by M3, earlier is better.
- E8. `POST /api/units/:id/message` {text} -> bridge send `{text}`; the next reply without an active order becomes `unit.activity` kind message. `BRIDGE_URL=http://127.0.0.1:4614` works (state.backend = "qm" when BRIDGE_URL port is 4614, else "mock"). Check with raid-qm once qm-bridge is up.
- K5. mock-bridge realism: vary scripts per component, emit the MCP-style name variant (`mcp__gbrain__search`) in 1 of 4 runs so the engine classifier is exercised; `usage` with plausible tokens and usd. Reply to a plain message (no `Order`) with a short answer in 2 to 3 s.
- K6. autopilot: use `memory` text (prefer components it mentions, +2); tie-break by lower unit id. Smoke test covers history and memory.
- R3. Review, then M2 end to end: order through mock shows `memory.recall` then `memory.remember`; with mock returning no gbrain calls (ask raid-eng-mock for `MOCK_NO_GBRAIN=1`) the fallback fires.

## M3 (15:45): teams, autopilot loop, veto window
- E9. `POST /api/teams` {id, members}: move members into team id (create with default name/color: 1 Red, 2 Blue, 3 Green #3fa34d, 4 Gold #d4a017, 5+ Gray #888888), remove from other teams, `PATCH` bridge unit team, emit `team.updated` and `unit.updated`. `PATCH /api/teams/:id` {autopilot?, name?}. Team orders via `POST /api/orders {teamId}`.
- E10. Autopilot loop every 3 s: for each team with `autopilot` on, idle members without a proposed order -> `POST $PROPOSER_URL/propose` (units with history, open targets not already in an active or proposed order, memory = last 5 recent summaries joined). Each proposal -> order `proposed`, source autopilot, `vetoDeadline = Date.now() + 15000`, unit `waiting_approval`, emit `order.proposed`.
- E11. Resolution: `cancel` -> cancelled, unit idle; `go` -> active now; `adjust` {unitId?, targetId?} -> apply then active now; deadline passes -> active (action `expired`). Cancel on an active order -> cancelled, unit idle, later reply for it ignored. Append one row per resolved proposal to data/vetoes.jsonl per the contract.
- K7. autopilot hardening and the mock `MOCK_FAIL=0.1` option (activity kind error, then a terminal `error` event with orderId; engine marks the order failed).
- R4. M3 end to end: team autopilot on, proposals appear with deadlines, cancel / go / adjust / expiry each produce a correct vetoes.jsonl row.

## M3/M4: Forge and Barracks
- E12. `state.unitTypes`: builtins (knight, ranger, scout; ready, progress 1) + `GET $FORGE_URL/types` every 2 s (source forge), emit `forge.updated` {type} on change. `POST /api/forge/types` proxies. Subscribe to `$FORGE_URL/events` too; each unit remembers its bridge URL.
- E13. `POST /api/units` {class, name?, team?}: builtin class -> model/effort from config, forge type only when ready (model = type.model, bridge = FORGE_URL); spawn next to the Barracks (first free tile around 20,20), register with its bridge, emit `unit.spawned`.
- E14. `POST /api/reset`: brain `/reset`, reload world, DELETE and re-register units, clear orders/teams/memory/stats, emit `state.snapshot`. `PATCH /api/units/:id` {team?, effort?, role?, autonomy?}.
- K8. mock-bridge `POST /reset` hook not needed (engine re-registers); instead a demo script mode `MOCK_SCRIPT=demo` where wave 1 on billing remembers a rule and wave 2 recalls that slug.

## M5 (16:25): demo path twice in a row, reset clean, no crash after 10 minutes of autopilot.

## Lead (raid-eng-plan)
Answer questions fast, run each milestone test, append docs/TEST.md, keep devbrain pages `code/engine`, `code/mock-bridge`, `code/autopilot` and `code/decisions/*` current, ping the Analyst at each milestone.
