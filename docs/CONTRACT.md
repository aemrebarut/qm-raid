# Contract between services (engine API, events, bridge, brain and proposer APIs)

Coordinates: the map is a 24 x 24 tile grid, integers `x` (east) and `y` (south), origin at the north-west corner. The UI maps tiles to isometric screen space. Engine: http://127.0.0.1:4610 serves /api/*. Board dev: http://127.0.0.1:4611 (proxy /api to 4610).

## GET /api/state
```json
{
  "components": [{"id": "billing", "name": "Billing", "zone": {"x": 1, "y": 1, "w": 7, "h": 6}}],
  "buildings": [{"id": "library", "kind": "gbrain", "x": 11, "y": 11}, {"id": "barracks", "kind": "barracks", "x": 20, "y": 20}, {"id": "forge", "kind": "river", "x": 3, "y": 20}],
  "units": [{"id": "u1", "name": "Ada", "class": "knight", "model": "claude-opus-5-5", "effort": "high", "role": "worker",
             "team": 1, "status": "idle", "pos": {"x": 12, "y": 14}, "orderId": null,
             "qm": {"sessionId": null, "sessionUrl": null}}],
  "targets": [{"id": "t12", "issue": 12, "title": "Retry double-charges a card", "component": "billing", "kind": "bug",
               "severity": 3, "status": "open", "pos": {"x": 4, "y": 3}, "customers": ["customers/acme-robotics"]}],
  "teams": [{"id": 1, "name": "Red", "color": "#d64545", "autopilot": false, "members": ["u1"]}],
  "orders": [{"id": "o1", "unitId": "u1", "targetId": "t12", "status": "active", "source": "user",
              "vetoDeadline": null, "reply": null}],
  "memory": {"pages": 42, "recent": [{"ts": "2026-09-27T15:01:00-07:00", "unitId": "u1", "op": "recall", "slugs": ["components/billing"], "summary": "..."}]},
  "stats": {"spentUsd": 0.0, "tokens": 0},
  "backend": "mock"
}
```
Enums. unit.status: idle, moving, recalling, working, remembering, waiting_approval, error. unit.class: knight, ranger, scout, oracle (oracle = the River model, later). order.status: proposed, active, done, cancelled, failed. order.source: user, autopilot. target.status: open, engaged, resolved. target.kind: bug, feature.

## GET /api/events (Server-Sent Events)
Each message is `data: <json>` with `{"seq": n, "ts": "<iso>", "type": "<type>", ...payload}`. On connect the server first sends `state.snapshot` with the full state.
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
- `POST /api/reset` resets the demo world

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
| gbrain MCP for QM agents | services/brain (gbrain serve) | 4617 if HTTP | raid-gbrain | QM |

Rules: no service imports another service's code. Shared TypeScript types live only in `contract/types.ts` (owned by the Analyst; ask for changes). Each service has its own package.json, `bun run dev`, README.md, `GET /health` returning `{"ok": true, "service": "<name>"}`, and a smoke test in its own `test/` folder. The engine picks the bridge with `BRIDGE_URL` (default http://127.0.0.1:4615, QM is http://127.0.0.1:4614) and the proposer with `PROPOSER_URL` (default http://127.0.0.1:4613, River is http://127.0.0.1:4612). If a dependency is down, the caller degrades (logs, keeps running) and never crashes.

## Bridge API (qm-bridge and mock-bridge implement the same API)
- `POST /units` {id, name, model, effort, role, team} -> {sessionId, sessionUrl}
- `POST /units/:id/send` {text} -> {ok}  (an order or a direct message)
- `PATCH /units/:id` {team} -> {ok}
- `DELETE /units/:id` -> {ok}
- `GET /events` SSE, each message `data: {...}` is one of:
  - `{"type": "activity", "unitId", "kind": "message"|"tool"|"thinking"|"error", "text", "tool"?, "args"?}`
  - `{"type": "reply", "unitId", "text"}` (final reply for the current order)
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
- `GET /page/:slug` -> {slug, title, body}
- `POST /reset` restores the demo world
Calls are serialized inside the service (PGLite is single-writer). The game brain lives at ~/Workspace/hackathon-gbrain/brain.pglite (keyless).

## Forge API (services/forge, port 4612; the River building)
The user names a new agent type and describes its job; the Forge generates synthetic training data for that job, fine-tunes a model with the River API, evaluates it, and then units of that type can be trained (spawned) from the Forge.
- `POST /types` {name, description} -> {typeId}
- `GET /types` -> [{id, name, description, status: "generating"|"training"|"evaluating"|"ready"|"failed", progress (0..1), stage (short text), examples (count), evalScore (0..1 or null), model (River model id or null)}]
- Forge units implement the Bridge API on the same port (POST /units, /units/:id/send, PATCH, DELETE, GET /events), running a small agent loop on the trained model with the brain service for recall and remember (emit them as `gbrain.recall` / `gbrain.remember` tool activity).
Engine side: `state.unitTypes` = [{id, name, source: "builtin"|"forge", status, progress, stage, model}]; `POST /api/forge/types` {name, description} proxies to the Forge; `POST /api/units` {class: "<typeId>"} spawns a unit of a forged type (only when ready); the engine routes each unit to its bridge (built-in classes to BRIDGE_URL, forge types to FORGE_URL, default http://127.0.0.1:4612) and polls GET /types every 2 s, emitting `forge.updated` {type} events.

## Proposer API (autopilot implements it; the Forge may later offer a trained commander on the same API)
- `POST /propose` {units: [{id, class, team, status, pos, history}], targets: [{id, component, severity, kind, status, pos, customers}], memory: "<short text>"} -> {proposals: [{unitId, targetId, reason}]}
- `GET /health`

## Veto log (data/vetoes.jsonl, written by the engine, read by raid-river)
One JSON row per resolved autopilot proposal: `{"ts", "proposal": {"unitId", "targetId", "reason"}, "context": {"units": [...], "targets": [...], "memory": "..."}, "action": "cancel"|"adjust"|"go"|"expired", "adjustedTo": {"unitId"?, "targetId"?}}`.
