# Contract between services (engine API, events, bridge, brain and proposer APIs)

Coordinates: the map is a 24 x 24 tile grid, integers `x` (east) and `y` (south), origin at the north-west corner. The UI maps tiles to isometric screen space. Engine: http://127.0.0.1:4610 serves /api/*. Board dev: http://127.0.0.1:4611 (proxy /api to 4610).

## GET /api/state
```json
{
  "components": [{"id": "billing", "name": "Billing", "zone": {"x": 1, "y": 1, "w": 7, "h": 6}}],
  "buildings": [{"id": "library", "kind": "gbrain", "x": 11, "y": 11}, {"id": "barracks", "kind": "barracks", "x": 20, "y": 20}, {"id": "forge", "kind": "river", "x": 3, "y": 20}],
  "units": [{"id": "u1", "name": "Ada", "class": "knight", "model": "gpt-6-astra", "effort": "high", "role": "worker",
             "team": 1, "status": "idle", "pos": {"x": 12, "y": 14}, "orderId": null,
             "qm": {"sessionId": null, "sessionUrl": null}}],
  "targets": [{"id": "t12", "issue": "LUM-12", "title": "Retry double-charges a card", "component": "billing", "kind": "bug",
               "severity": 3, "status": "open", "pos": {"x": 4, "y": 3}, "customers": ["acme-robotics"]}],
  "teams": [{"id": 1, "name": "Red", "color": "#d64545", "autopilot": false, "members": ["u1"]}],
  "orders": [{"id": "o1", "unitId": "u1", "targetId": "t12", "status": "active", "source": "user",
              "vetoDeadline": null, "reply": null}],
  "unitTypes": [{"id": "knight", "name": "Knight", "source": "builtin", "status": "ready", "progress": 1, "stage": "", "model": "gpt-6-astra"}],
  "memory": {"pages": 42, "recent": [{"ts": 1790546460000, "unitId": "u1", "op": "recall", "slugs": ["components/billing"], "summary": "..."}]},
  "stats": {"spentUsd": 0.0, "tokens": 0},
  "backend": "mock"
}
```
Enums. unit.status: idle, moving, recalling, working, remembering, waiting_approval, error. unit.class: knight, ranger, scout, oracle (oracle = the River model, later). order.status: proposed, active, done, cancelled, failed. order.source: user, autopilot. target.status: open, engaged, resolved. target.kind: bug, feature.

## GET /api/events (Server-Sent Events)
Each message is `data: <json>` with `{"seq": n, "ts": <epoch ms>, "type": "<type>", ...payload}`. On connect the server first sends `state.snapshot` with the full state.
- `state.snapshot` {state}
- `unit.spawned` {unit} · `unit.updated` {unit} · `unit.moved` {unitId, pos} · `unit.status` {unitId, status}
- `unit.activity` {unitId, kind: "message"|"tool"|"thinking"|"error", text, tool?: string, args?: object}
- `order.proposed` {order} (autopilot; has vetoDeadline) · `order.updated` {order} (any status change; `reply` set when done)
- `memory.recall` {unitId, slugs: [...], summary} · `memory.remember` {unitId, slug, summary} · `memory.link` {from, to, linkType}
- `target.updated` {target} · `team.updated` {team} · `stats` {spentUsd, tokens}

## Commands (POST/PATCH JSON, reply `{"ok": true, ...}` or `{"ok": false, "error": "..."}`)
- `POST /api/units` {class, name?, team?} spawns a unit (model from class)
- `PATCH /api/units/:id` {team?, effort?, role?, autonomy?}
- `POST /api/units/:id/message` {text}: the side panel order box
- `POST /api/orders` {unitIds?: [...], teamId?: n, targetId}: user order (one order per unit)
- `POST /api/orders/:id/cancel` · `POST /api/orders/:id/go` · `POST /api/orders/:id/adjust` {unitId?, targetId?}
- `POST /api/teams` {id, members} (control group assign) · `PATCH /api/teams/:id` {autopilot?, name?}
- `POST /api/targets` {title?, body?, component?, kind?, severity?, customers?} -> {target}: spawns a new issue. With no title the engine asks the brain for a random issue from its pool; otherwise it uses the given fields (component defaults to the least busy one, kind bug, severity 2). The engine picks a free tile inside the component zone, calls brain `POST /issues` with it, and emits `target.spawned` {target} with what the brain returns. The brain is the only allocator of issue and target ids. If the brain is down the engine answers 503 and creates nothing (no local targets).
- `DELETE /api/units/:id` -> {ok}: cancels the unit's active order, calls the bridge DELETE /units/:id, removes the unit, emits `unit.retired` {unitId}
- `POST /api/reset` resets the demo world
- Library proxies (the board talks only to the engine): `GET /api/brain/graph`, `GET /api/brain/search?q=`, `GET /api/brain/page?slug=`, `GET /api/brain/stats` pass through to the brain service unchanged
- Unit models are Codex models QM allows (HARNESS=codex): gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna; effort auto, low, medium, high or xhigh. Class map: knight = gpt-6-astra high, ranger = gpt-6-sol medium, scout = gpt-6-luna low. Unknown names fall back to QM's default.
- Types: `contract/types.ts` is authoritative where an example disagrees. Timestamps are epoch milliseconds everywhere; issue ids are strings like "LUM-12".

## Team workflows (agent graphs inside a team)
A team may carry a `workflow`: a small graph of role nodes, each bound to one member unit. Presets: `solo` (one node), `pair` (implementer -> reviewer), `trio` (planner -> implementer -> reviewer, reviewer `changes` loops back to implementer), `fanout` (planner -> every implementer in parallel -> reviewer waits for all). `custom` is any graph the user draws. More presets (Emre, 15:45):
  - `recon` (scout -> implementer -> reviewer, changes loop to implementer). Scout: "Recall first. Investigate only: reproduce, point to the code, list the house rules and past learnings that apply. Do not fix."
  - `testfirst` (tester -> implementer -> reviewer, changes loop to implementer). Tester: "Recall first. Write the failing regression test and the exact acceptance check. Do not fix."
  - `herald` (implementer -> reviewer -> herald on approved; changes loop to implementer). Herald: "Write the customer update for the affected customers in the house tone: what broke, what we fixed, what they need to do." Best played by a Forge-trained unit (Refund Ranger writes customer replies), so River shows up inside a workflow.
  - `duel` (two implementers in parallel -> judge; the judge waits for both). Judge: "Compare both fixes against the house rules. Pick the better one, say why in two lines, and end with VERDICT: APPROVED (winner: <name>) or VERDICT: CHANGES: <what> if neither is acceptable." Changes loop to both implementers.
  Parallel starts: a workflow may set `entries` (string[]); when present, the run starts every listed node at once and `entry` is only the first of them (kept for older readers). `duel` sets `entries` to both implementers. Preset member order: roles are filled in the order listed; `duel` needs 3 (implementer, implementer, judge).
- `PUT /api/teams/:id/workflow` {preset} (the engine assigns members to roles in member order) or {workflow} (full graph) -> {team}; `DELETE /api/teams/:id/workflow` clears it.
- `POST /api/orders` {teamId, targetId} on a team with a workflow starts a WorkflowRun instead of one order per unit. The entry node gets the normal order prompt plus its role instructions. When a node's order ends, the engine follows its outgoing edges: `done` always; a reviewer's reply must end with a line `VERDICT: APPROVED` or `VERDICT: CHANGES: <what to change>`, which selects `approved` or `changes` edges. The next node's order text holds the issue, its role instructions, and the previous nodes' replies (latest last). A node with several incoming edges waits for all branches started in this run (join). `changes` loops count toward `maxLoops` (default 2); past it the run ends `needs_human`. The run is `done` when a node with no matching outgoing edge finishes; then the target is resolved. Cancelling the run cancels its active orders.
- Clarifications: `pair` also has reviewer -> implementer on `changes`. Cancelling any order of a running run cancels the run (no extra endpoint). A reviewer reply with no VERDICT line counts as approved (the step summary says so). A failed step fails the run. Runs that end failed, cancelled or needs_human put the target back to open. Autopilot skips units of teams that have a workflow (stretch: autopilot proposes a whole-team run instead).
- Every step is a normal order (`source: "workflow"`), so units walk, recall and remember as usual. Events: `workflow.updated` {run} on every change, `workflow.handoff` {runId, fromUnitId, toUnitId, nodeId, summary} when work passes between units (the board animates a scroll flying from unit to unit). `state.workflowRuns` holds recent runs.
- Default role instructions (engine config): planner "Recall first. Write a short numbered plan for the implementer; do not implement."; implementer "Recall first. Implement the plan or apply the review changes; remember what you learned."; reviewer "Recall the house rules. Review the implementation against the plan and the rules. End with VERDICT: APPROVED or VERDICT: CHANGES: <what>."
- The mock bridge answers reviewer orders with `VERDICT: CHANGES` the first time and `VERDICT: APPROVED` the second, so the loop is visible in tests.

## Microservices (every component is its own service or package; they talk only over HTTP)

| Service | Dir | Port | Owner | Talks to |
|---|---|---|---|---|
| engine (game state, orders, teams, SSE) | services/engine | 4610 | raid-eng | bridge, brain, autopilot |
| board (Three.js UI) | apps/board | 4611 | raid-ui | engine only (/api proxy) |
| forge (River building: trains new unit types, runs their units) | services/forge | 4612 | raid-river | River API, brain |
| autopilot (heuristic proposer) | services/autopilot | 4613 | raid-eng | nobody (answers /propose) |
| qm-bridge (real QM agents) | services/qm-bridge | 4614 | raid-qm | QM |
| mock-bridge (fake agents) | services/mock-bridge | 4615 | raid-eng | nobody |
| brain (GBrain game memory) | services/brain | 4616 | raid-gbrain | gbrain CLI |
| test engine on mock (automated tests and reviewers only) | services/engine with PORT=4618, BRIDGE_URL=4615 | 4618 | raid-eng | mock-bridge, brain |
| test board (reviews and smokes, on the 4618 test engine) | apps/board with ENGINE_URL=http://127.0.0.1:4618 | 4619 | raid-ui | test engine |
| art showroom (asset library preview) | packages/art | 4620 | raid-art | nothing |
| gbrain MCP for QM agents | services/brain (gbrain serve) | 4617 if HTTP | raid-gbrain | QM |

Rules: no service imports another service's code. Shared TypeScript types live only in `contract/types.ts` (owned by the Analyst; ask for changes). Each service has its own package.json, `bun run dev`, README.md, `GET /health` returning `{"ok": true, "service": "<name>"}`, and a smoke test in its own `test/` folder. The engine picks the bridge with `BRIDGE_URL` (default http://127.0.0.1:4615, QM is http://127.0.0.1:4614) and the proposer with `PROPOSER_URL` (default http://127.0.0.1:4613, River is http://127.0.0.1:4612). If a dependency is down, the caller degrades (logs, keeps running) and never crashes.

## Bridge API (qm-bridge and mock-bridge implement the same API)
- `POST /units` {id, name, model, effort, role, team} -> {sessionId, sessionUrl}
- `POST /units/:id/send` {text, orderId?, targetId?, componentId?} -> {ok}  (orders carry orderId, targetId, componentId; direct messages omit them)
- `PATCH /units/:id` {team} -> {ok}
- `DELETE /units/:id` -> {ok}
- `GET /events` SSE, each message `data: {...}` is one of:
  - `{"type": "activity", "unitId", "kind": "message"|"tool"|"thinking"|"error", "text", "tool"?, "args"?}`
  - `{"type": "reply", "unitId", "orderId"?, "text"}` (terminal: final reply for that order)
  - `{"type": "error", "unitId", "orderId"?, "text"}` (terminal: the order failed)
  - activity events also carry `orderId` when they belong to an order. The engine ignores terminal events whose orderId is not the unit's current order (stale completions after cancel).
  - `{"type": "usage", "unitId", "tokens", "usd"}` (optional)
- `GET /health`

GBrain tool calls made by agents arrive as activity with `kind: "tool"` and `tool` starting with `gbrain` (for example `gbrain.recall`, `gbrain.remember`, `gbrain.search`, `gbrain.get_page`, `gbrain.put_page`, `gbrain.add_link`). The engine maps read tools to `memory.recall` and write tools to `memory.remember` / `memory.link`.

## Brain API (services/brain, port 4616)
- `GET /world` -> the world in the state shape (components, buildings, targets, customers) used by the engine at start and on reset
- `POST /recall` {componentId, targetId, unitId} -> {slugs, context}  (fallback when agents made no gbrain tool call)
- `POST /remember` {unitId, targetId, text} -> {slug}  (fallback)
- `GET /graph` -> {nodes: [{id, type, title}], edges: [{from, to, type}]}
- `GET /stats` -> {pages}
- `GET /search?q=` -> [{slug, title, snippet}]
- `GET /page?slug=<slug>` -> {slug, title, body}  (slug as a query parameter, URL-encoded, so slashes are safe)
- `POST /issues` {pos, title?, body?, component?, kind?, severity?, customers?} -> {target} (a full Target): under the brain write lock the brain allocates the next LUM number and the target id `t<number>` (LUM-110 is t110), writes `issues/<issue>` linked to its component and customers, and registers the target in its world, so GET /world includes it (restart recovery) and /recall and /remember resolve its targetId like any seeded target. Clients never send an issue id; there are no collisions to handle. With no title it draws the next unused issue from a pool of about 15 prepared synthetic Lumen issues (each touching a house rule, so recall matters). The pool resets with /reset.
- `POST /reset` restores the demo world
One DB owner: services/brain is the only process that opens the game brain. All access, including GBrain MCP for QM agents, goes through it (for example it runs `gbrain serve` as its own child and exposes an MCP facade at http://127.0.0.1:4617/mcp, or another design raid-gbrain chooses and agrees with raid-qm-plan before M2). Nothing else runs `gbrain` against the game brain while the service is up.

Slug conventions: `components/<componentId>`, `issues/<issue lowercased, e.g. lum-12>`, `companies/<customerId>`, `people/<contact-slug>`, `units/<unitId>`, `learnings/<issue>-<unitId>-<epoch ms>`. Target.customers holds customer ids. The game brain lives at ~/Workspace/hackathon-gbrain/brain.pglite (keyless).

## Forge API (services/forge, port 4612; the River building)
The user names a new agent type and describes its job; the Forge generates synthetic training data for that job, fine-tunes a model with the River API, evaluates it, and then units of that type can be trained (spawned) from the Forge.
- `POST /types` {name, description, dryRun?} -> {typeId}  (`dryRun: true` forces the fake 60 s pipeline even with the key set; every smoke test and reviewer check must pass it)
- `GET /types` -> [{id, name, description, status: "generating"|"training"|"evaluating"|"ready"|"failed", progress (0..1), stage (short text), examples (count), evalScore (0..1 or null), model (River model id or null)}]
- Forge units implement the Bridge API on the same port (POST /units, /units/:id/send, PATCH, DELETE, GET /events), running a small agent loop on the trained model with the brain service for recall and remember (emit them as `gbrain.recall` / `gbrain.remember` tool activity).
Engine side: `state.unitTypes` = [{id, name, source: "builtin"|"forge", status, progress, stage, model}]; `POST /api/forge/types` {name, description} proxies to the Forge; `POST /api/units` {class: "<typeId>"} spawns a unit of a forged type (only when ready); the engine routes each unit to its bridge (built-in classes to BRIDGE_URL, forge types to FORGE_URL, default http://127.0.0.1:4612) and polls GET /types every 2 s, emitting `forge.updated` {unitType} events. The full engine event union is `EngineEvent` in contract/types.ts.

## Proposer API (autopilot implements it; the Forge may later offer a trained commander on the same API)
- `POST /propose` {units: [{id, class, team, status, pos, history}], targets: [{id, component, severity, kind, status, pos, customers}], memory: "<short text>"} -> {proposals: [{unitId, targetId, reason}]}. `history` = [{targetId, component}], most recent last, at most 10; `memory` = the last 5 memory summaries joined with newlines. Tool names containing `gbrain` (for example `mcp__gbrain__put_page`) count as GBrain calls. `vetoDeadline` is epoch ms; `adjust` applies the change and activates at once.
- `GET /health`

## Veto log (data/vetoes.jsonl, written by the engine, read by raid-river)
One JSON row per resolved autopilot proposal: `{"ts", "proposal": {"unitId", "targetId", "reason"}, "context": {"units": [...], "targets": [...], "memory": "..."}, "action": "cancel"|"adjust"|"go"|"expired", "adjustedTo": {"unitId"?, "targetId"?}}`.
