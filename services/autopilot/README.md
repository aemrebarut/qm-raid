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
  - Score per (unit, target): `severity * 10` + 6 if the unit's history has the component + 2 if `memory` mentions the component - Chebyshev distance * 0.5.
  - Greedy, best pair first; each unit and target used at most once per call; ties by lower unit id, then lower target id. Output order = pick order (highest score first).
  - `history`: `[{targetId, component}]` (team decision); plain strings are accepted as target or component ids.
  - Empty input -> `{proposals: []}`; bad JSON -> 400 `{ok: false, error, proposals: []}`.
- `reason` is plain words, for example "severity 3 bug in auth, 4 tiles away, knows auth".
