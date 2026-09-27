# engine (services/engine, port 4610)

Game server for QM Raid: in-memory state, orders, teams, tile movement, and the SSE event stream the board renders. Owner: raid-eng-impl. Contract: `docs/CONTRACT.md` and `contract/types.ts` (every SSE message is an `EngineEvent`).

## Run
```sh
cd services/engine
bun run dev            # 127.0.0.1:4610, watch mode
bun test/smoke.ts      # against the running engine and bridge
```
Env: `PORT` (4610), `BRIDGE_URL` (mock http://127.0.0.1:4615; QM http://127.0.0.1:4614), `BRAIN_URL` (http://127.0.0.1:4616), `PROPOSER_URL` (4613), `FORGE_URL` (4612).

## Files
- `src/index.ts` HTTP routes (Bun.serve, `idleTimeout: 0` for SSE), Library proxies, error handling
- `src/game.ts` world load, orders, movement tick, bridge event mapping, teams, spawn, reset
- `src/store.ts` state holder, typed `emit()` (seq, epoch ms ts), SSE fan-out, last 200 events
- `src/bridge.ts` Bridge API client and SSE follower with reconnect
- `src/config.ts` ports, URLs, class to model map, speeds
- `src/fixture.ts` fallback world (mirrors the brain world) and 6 default units
- `src/http.ts` fetch helpers with timeouts, throttled logging
- `test/smoke.ts` end-to-end smoke test

## API
`GET /health`, `GET /api/state`, `GET /api/events` (SSE, `state.snapshot` first, `: ping` every 15 s), `POST /api/orders` {unitIds? | teamId?, targetId}, `POST /api/orders/:id/cancel`, `POST /api/units` {class, name?, team?}, `PATCH /api/units/:id` {team?, effort?, role?}, `POST /api/units/:id/message` {text}, `POST /api/teams` {id, members}, `PATCH /api/teams/:id` {autopilot?, name?}, `POST /api/reset`, Library proxies `GET /api/brain/graph|stats|search?q=|page?slug=`. Debug: `GET /api/debug/events`.
Errors are `{ok: false, error}` with 400 (bad input), 404 (unknown id), 502 (dependency down).

## Behavior
- World: brain `GET /world` at start (4 s timeout); the brain has no units, so the 6 fixture units are added. Brain down: the local fixture.
- Orders: one per unit (a new order cancels the old), unit steps one tile every 333 ms (diagonal allowed) to a free tile next to the target, then `working` and the bridge gets `{text, orderId, targetId, componentId}`. `reply` -> order `done`, target `resolved`; `error` -> order `failed`. Terminal events for a non-current orderId are dropped.
- GBrain tool activity (tool name contains `gbrain`): contains `link` -> `memory.link`, contains put/remember/write/capture/add_page -> `memory.remember`, else `memory.recall`; the unit shows `recalling` / `remembering` for 1.5 s.
- Dependencies down: log once a minute, retry every 2 s, keep serving.
