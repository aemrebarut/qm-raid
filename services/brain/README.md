# brain (raid-gbrain)

The game world and GBrain game memory over HTTP (Brain API in docs/CONTRACT.md), plus a GBrain MCP facade for QM agents.

- Run: `bun run dev` (HTTP on 127.0.0.1:4616, MCP facade on 127.0.0.1:4617/mcp). Env: `BRAIN_PORT`, `BRAIN_MCP_PORT`, `BRAIN_GBRAIN_HOME` (defaults to ~/.gbrain, the game brain at ~/Workspace/hackathon-gbrain/brain.pglite).
- Smoke: with the service up, `bun run test` (read-only); `SMOKE_WRITE=1 bun run test` also writes a learning and forgets it again, so the brain stays clean.
- Single DB owner: this process starts one `gbrain serve` (stdio MCP) child and serializes every call through it. Nothing else may run `gbrain` against the game brain while it is up.
- World source: `world/layout.json` (tiles) and `world/brain/**.md` (pages, imported with `gbrain import world/brain --no-embed` then `gbrain extract links --source db`, service stopped).

## HTTP (4616)
`GET /health`, `GET /world`, `POST /recall {componentId, targetId, unitId}`, `POST /remember {unitId, targetId, text}`, `GET /graph`, `GET /stats`, `GET /search?q=`, `GET /page?slug=`, `POST /reset` (soft-deletes all learnings/* and units/* pages, rewrites world pages from world/brain; also `world/reset.sh`). Extra for tests: `POST /forget {slug}` (learnings/* and units/* only).

## MCP facade (4617)
`POST /mcp` JSON-RPC, stateless, auth none: `initialize`, `tools/list`, `tools/call`. Tools: `recall`, `remember`, `search`, `get_page`, `add_link`.
```
curl -s 127.0.0.1:4617/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Gotchas
- `add_link` over gbrain MCP is refused on a managed brain (writer_coordinator_required). Links come from wikilinks in page bodies, which `gbrain serve` sweeps into typed links within about a second. The facade's `add_link` appends a wikilink to the from page.
- Learnings are `learnings/<issue>-<unitId>-<epoch ms>` pages plus a `remember` fact scoped to `components/<id>`.
- Deletes are soft (`delete_page` with force); a unit page soft-deleted by a reset is restored on the unit's next remember.
