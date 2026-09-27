# autopilot (port 4613)

Heuristic proposer on the Proposer API (docs/CONTRACT.md). The engine asks it for orders for idle units of autopilot teams; the user gets a 15 s veto window. No dependencies, no outgoing calls.

## Run
```sh
bun run dev          # 127.0.0.1:4613 (PORT to override)
bun test/smoke.ts    # against the running service (AUTOPILOT_URL to override)
```

## API
- `GET /health` -> `{ok: true, service: "autopilot"}`
- `POST /propose` {units: [{id, class, team, status, pos, history}], targets: [{id, component, severity, kind, status, pos, customers}], memory: "<text>"} -> `{proposals: [{unitId, targetId, reason}]}`
  - Only units with status `idle` (missing = idle) and targets with status `open` (missing = open).
  - Score per (unit, target): `severity * 10` + 6 if the unit's history has the component + memory bonus - Chebyshev distance * 0.5.
  - Memory bonus from `memory` (the engine sends the last memory summaries, one per line): +3 if a line names the component (or a `rules/<component>-<name>` slug) together with a learning or rule (`learnings/...`, "learned", "rule"); else +2 if a line merely names the component.
  - Greedy, best pair first; each unit and target used at most once per call; ties by lower unit id, then lower target id. Output order = pick order (highest score first).
  - `history`: `[{targetId, component}]` (team decision); plain strings are accepted as target or component ids.
  - Empty input -> `{proposals: []}`; bad JSON -> 400 `{ok: false, error, proposals: []}`.
- `reason` is plain words, for example "severity 3 bug in billing, 2 tiles away, knows billing, team learned the idempotency rule". Memory parts: "team learned the <rule> rule" (a rules/ slug), "team has a learning on <component>", or "recent memory mentions <component>".
