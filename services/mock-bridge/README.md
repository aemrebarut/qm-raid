# mock-bridge (port 4615)

Fake agents behind the Bridge API (docs/CONTRACT.md), so the engine and board work without QM. No dependencies.

## Run
```sh
bun run dev                     # 127.0.0.1:4615
MOCK_SPEED=5 bun run dev        # scripts play 5x faster (tests)
MOCK_FAIL=0.1 bun run dev       # 10% of orders end in a terminal error event
MOCK_NO_GBRAIN=1 bun run dev    # no gbrain tool calls (exercises the engine's brain fallback)
bun test/smoke.ts               # against the running service (set MOCK_SPEED to match the server)
```
Env (defaults): `PORT` (4615), `MOCK_SPEED` (1), `MOCK_FAIL` (0), `MOCK_NO_GBRAIN` (off), `MOCK_MCP_NAMES` (0.25 = 1 in 4 runs report gbrain tools with MCP names: `mcp__gbrain__search`, `mcp__gbrain__get_page`, `mcp__gbrain__put_page`, `mcp__gbrain__add_link`).

## Runtime toggles (debug, not part of the Bridge API)
Change the shared mock without restarting it; the env vars are only the start values. Settings apply to sends made after the change.
```sh
curl -s 127.0.0.1:4615/debug/config                                   # {ok, config}
curl -s -XPOST 127.0.0.1:4615/debug/config -H 'content-type: application/json' -d '{"noGbrain":true}'
curl -s -XPOST 127.0.0.1:4615/debug/config -H 'content-type: application/json' -d '{"fail":1}'
curl -s -XPOST 127.0.0.1:4615/debug/config -H 'content-type: application/json' -d '{"speed":1,"fail":0,"noGbrain":false,"mcpNames":0.25}'
```
Fields: `speed` (0.1 to 100), `fail` (0 to 1), `noGbrain` (bool), `mcpNames` (0 to 1). The smoke test sets and then restores them.

## API
- `GET /health` -> `{ok, service: "mock-bridge", units, clients}`
- `POST /units` {id, name, model, effort, role, team} -> `{sessionId: "mock-<id>", sessionUrl: null}` (idempotent)
- `POST /units/:id/send` {text, orderId?, targetId?, componentId?} -> `{ok}`. Unknown unit is auto-registered.
  - Order (the body has `orderId`; only that decides): over 6 to 10 s emits thinking, `gbrain.recall` {query, slugs}, messages, `read_file`, `edit_file`, `run_tests`, `gbrain.remember` {slug, text, links}, sometimes `gbrain.add_link` {from, to, linkType}, `usage`, then `reply`. With a rule page for the component it also reads it with `gbrain.get_page`. If the order text contains a `learnings/...` slug (the engine assigns one), `gbrain.remember` uses exactly that slug. On failure (`fail`): `run_tests`, an activity of kind `error`, `usage`, then a terminal `error` event, no remember. Every activity/reply/error carries the `orderId`. A new order replaces the running one (the old one gets no terminal event).
  - Direct message (no `orderId`, even if the text names an issue): short chat in 2 to 3 s ending in a `reply` without `orderId`; runs alongside a running order and never cancels it.
- `PATCH /units/:id` {team} -> `{ok}` (404 if unknown)
- `DELETE /units/:id` -> `{ok}`; stops that unit's scripts
- `GET /events` SSE, `data: <BridgeEvent>` per message, `: ping` every 15 s
- `GET /units`, `GET /units/:id` (debug: unit and its last 200 events)

The order text is parsed loosely: `componentId` from the body (else a `Component:` line), the issue from an id like `LUM-12`, customers from a `Customers:` line or `companies/<id>` slugs. Recall slugs include the world rule page (`rules/billing-idempotency`, `rules/auth-clock-skew`, `rules/search-tenant-scope`). Slugs follow the contract: `components/<c>`, `issues/lum-12`, `companies/<id>`, `learnings/<issue>-<unitId>-<epoch ms>`.
