# mock-bridge (port 4615)

Fake agents behind the Bridge API (docs/CONTRACT.md), so the engine and board work without QM. No dependencies.

## Run
```sh
bun run dev                     # 127.0.0.1:4615
MOCK_SPEED=5 bun run dev        # scripts play 5x faster (tests)
MOCK_FAIL=0.1 bun run dev       # 10% of orders end in a terminal error event
bun test/smoke.ts               # against the running service (set MOCK_SPEED to match the server)
```
Env: `PORT` (4615), `MOCK_SPEED` (1), `MOCK_FAIL` (0).

## API
- `GET /health` -> `{ok, service: "mock-bridge", units, clients}`
- `POST /units` {id, name, model, effort, role, team} -> `{sessionId: "mock-<id>", sessionUrl: null}` (idempotent)
- `POST /units/:id/send` {text, orderId?, targetId?, componentId?} -> `{ok}`. Unknown unit is auto-registered.
  - Order (has `orderId`, or the text names an issue): over 6 to 10 s emits thinking, `gbrain.recall` {query, slugs}, messages, `read_file`, `edit_file`, `run_tests`, `gbrain.remember` {slug, text, links}, sometimes `gbrain.add_link` {from, to, linkType}, `usage`, then `reply`. Every activity/reply/error carries the `orderId`. A new order replaces the running one (the old one gets no terminal event).
  - Direct message (no `orderId`): short chat in 2 to 3.5 s ending in a `reply` without `orderId`; runs alongside an order.
- `PATCH /units/:id` {team} -> `{ok}` (404 if unknown)
- `DELETE /units/:id` -> `{ok}`; stops that unit's scripts
- `GET /events` SSE, `data: <BridgeEvent>` per message, `: ping` every 15 s
- `GET /units`, `GET /units/:id` (debug: unit and its last 200 events)

The order text is parsed loosely: `componentId` from the body (else a `Component:` line), the issue from an id like `LUM-12`, customers from a `Customers:` line or `companies/<id>` slugs. Slugs follow the contract: `components/<c>`, `issues/lum-12`, `companies/<id>`, `learnings/<issue>-<unitId>-<epoch ms>`.
