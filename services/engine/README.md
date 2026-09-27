# engine (services/engine, port 4610)

Game server for QM Raid: in-memory state, orders, teams, tile movement, and the SSE event stream the board renders. Owner: raid-eng-impl. Contract: `docs/CONTRACT.md` and `contract/types.ts` (every SSE message is an `EngineEvent`).

## Run
```sh
cd services/engine
bun run dev            # 127.0.0.1:4610, watch mode
bun test/smoke.ts      # against the running engine and bridge
```
Env: `PORT` (4610), `BRIDGE_URL` (mock http://127.0.0.1:4615; QM http://127.0.0.1:4614), `BRAIN_URL` (http://127.0.0.1:4616), `PROPOSER_URL` (4613), `FORGE_URL` (4612), `VETO_LOG` (repo `data/vetoes.jsonl`), `BRAIN_RESET` (default 1; `0` makes `POST /api/reset` skip brain `/reset`, required for test instances such as `PORT=4618 BRIDGE_URL=http://127.0.0.1:4615 BRAIN_RESET=0`), `CORS_ORIGINS` (comma-separated browser origins added to the allowlist).

Browser safety: CORS headers only for the board origins (127.0.0.1 / localhost on 4611, 4619 and the frozen demo board 4621, plus `CORS_ORIGINS`). POST/PATCH/DELETE with any other `Origin` get 403 (blocks bodyless cross-site posts); a non-empty body must be `application/json` (415 otherwise). Requests without `Origin` (curl, services, tests) are allowed.

## Files
- `src/index.ts` boot: startGame, Bun.serve (`idleTimeout: 0` for SSE)
- `src/app.ts` HTTP routes, CORS allowlist and CSRF guards, Library proxies, error handling
- `src/sse.ts` GET /api/events, drops clients with more than 2000 unread events
- `src/game.ts` world load, orders, movement tick, bridge event mapping, teams, spawn, reset, autopilot
- `src/flowlink.ts` links team workflows (`src/workflow.ts`, owner raid-eng-flow) to the game; logs "team workflows disabled" if that module fails to load
- `src/store.ts` state holder, typed `emit()` (seq, epoch ms ts), SSE fan-out, last 200 events
- `src/bridge.ts` Bridge API client and SSE follower with reconnect
- `src/config.ts` ports, URLs, class to model map, speeds
- `src/fixture.ts` fallback world (mirrors the brain world) and 6 default units
- `src/http.ts` fetch helpers with timeouts, throttled logging
- `src/targets.ts` POST /api/targets (owner raid-eng-mock)
- `test/smoke.ts` end-to-end smoke test

## API
`GET /health`, `GET /api/state`, `GET /api/events` (SSE, `state.snapshot` first, `: ping` every 15 s), `POST /api/orders` {unitIds? | teamId?, targetId}, `POST /api/orders/:id/cancel`, `POST /api/units` {class, name?, team?}, `PATCH /api/units/:id` {team?, effort?, role?}, `POST /api/units/:id/message` {text}, `POST /api/teams` {id, members}, `PATCH /api/teams/:id` {autopilot?, name?}, `PUT /api/teams/:id/workflow` {workflow}, `DELETE /api/teams/:id/workflow`, `POST /api/targets` {title?, body?, component?, kind?, severity?, customers?} (spawns an issue via brain `POST /issues`, `src/targets.ts`, owner raid-eng-mock; 503 when the brain is down), `POST /api/reset`, Library proxies `GET /api/brain/graph|stats|search?q=|page?slug=`. Debug: `GET /api/debug/events`.
Errors are `{ok: false, error}` with 400 (bad input), 404 (unknown id), 502 (dependency down).

## Behavior
- World: brain `GET /world` at start (4 s timeout); the brain has no units, so the 6 fixture units are added. Brain down: the local fixture.
- Orders: one per unit (a new order cancels the old), unit steps one tile every 333 ms (diagonal allowed) to a free tile next to the target, then `working` and the bridge gets `{text, orderId, targetId, componentId}`. `reply` -> order `done`, target `resolved`; `error` -> order `failed`. Terminal events for a non-current orderId are dropped.
- GBrain tool activity (tool name contains `gbrain`): contains `link` -> `memory.link`, contains put/remember/write/capture/add_page -> `memory.remember`, else `memory.recall`; the unit shows `recalling` / `remembering` for 1.5 s.
- Bridge events (re)connect: every idle unit on that bridge is re-registered (`POST /units`, idempotent) and gets fresh `qm` session links via `unit.updated`, so a bridge restart needs no reset. Units mid-order re-register lazily (send 404 -> POST /units -> retry).
- Team workflows: an order for a team with a workflow starts a run; each node is a `workflow` order whose prompt adds `Role: <role>. <instructions>` and `Previous work:`. Autopilot skips such teams.
- Spawn: builtin classes appear at the Barracks door (the row in front of its 3 x 3 footprint), forged types at the Forge door. No unit spawns, stops or waits on a building footprint or a zone wall (zone border); a unit found on one steps off on the next tick and at reset.
- Reset: every order and workflow run is dropped before the first await, so a late reply or a workflow step cannot send work into the dying world; writes during a reset get 409.
- Dependencies down: log once a minute, retry every 2 s, keep serving.
