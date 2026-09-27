# qm-bridge

Implements the Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 against a local QM dev instance: one QM session per unit, run events streamed as Bridge events on GET /events, GBrain MCP tool calls normalized to `gbrain.<op>`.

QM access goes through the dev portal (`QM_PORTAL_URL`, default http://localhost:8129). Its loopback auth bypass (`PORTAL_LOCAL_AUTH_BYPASS`, local dev only) relays `/api/turn`, `/api/runs/:id`, `/api/runs/:id/events` and `/api/sessions/:id` to QM core with the portal's own signing, so this service holds no QM secrets. Non-GET requests send `origin: <portal url>`.

Run: QM up first (`cd qm && HARNESS=codex bash scripts/dev-instance.sh up --surface web`), then `bun run dev`. Smoke: `bun run smoke` (one QM turn, prints status, sessionId, reply), `bun run bridge-smoke` (Bridge API end to end).

Files:
- `src/qm.ts`: QM client over the portal (principal, startTurn, getRun, waitRun, sessionUrl).
- `test/smoke.ts`: M1 smoke, one turn "Say hello in five words".

Plan and QM API notes: docs/lanes/qm-plan.md.
