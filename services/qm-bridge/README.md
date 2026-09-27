# qm-bridge

Implements the Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 against a local QM dev instance: one QM session per unit, run events streamed as Bridge events on GET /events, GBrain MCP tool calls normalized to `gbrain.<op>`.

QM access goes through the dev portal (`QM_PORTAL_URL`, default http://localhost:8129). Its loopback auth bypass (`PORTAL_LOCAL_AUTH_BYPASS`, local dev only) relays `/api/turn`, `/api/runs/:id`, `/api/runs/:id/events` and `/api/sessions/:id` to QM core with the portal's own signing, so this service holds no QM secrets. Non-GET requests send `origin: <portal url>`.

Run: QM up first (`cd qm && HARNESS=codex bash scripts/dev-instance.sh up --surface web`), then `bun run dev`. Smoke: `bun run smoke` (one QM turn, prints status, sessionId, reply), `bun run bridge-smoke` (Bridge API end to end).

Files:
- `src/server.ts`: Bridge API on 127.0.0.1:4614 (health, units, send, patch, delete, SSE /events). One QM session per unit (threadRef `web:<principal>:raid-<unitId>-<boot>`), one active run per unit with a FIFO queue, an intro turn at spawn (streamed as chat, never terminal), exactly one terminal `reply` or `error` per send, decided from GET /api/runs/:id (never from RUN_FINISHED alone).
- `src/qm.ts`: QM client over the portal (principal, startTurn, getRun, waitRun, findSessionId, archiveSession, sessionUrl).
- `src/tools.ts`: tool name normalization (`gbrain_search` -> `gbrain.search`; built-ins as `skills.read`, `memory.rewrite`).
- `test/smoke.ts`: M1 smoke, one turn "Say hello in five words".
- `test/bridge-smoke.ts`: spawn, one order, wait for its terminal event, delete.
- `test/qm.test.ts`: unit tests with a fetch fixture (`bun test`).

Usage: QM exposes only org-wide spend (portal `/admin/api/spend`), so every 5 s the bridge splits the token delta across units that had a run in the last 15 s and emits `usage {unitId, tokens, usd}`. usd is what QM reports (0 on the ChatGPT OAuth harness). Approximate per unit, right in total.

Model and effort: `model` is passed to QM only when it is one of the Codex models QM allows (GET /api/runtime-config modelsByHarness.codex, for example gpt-5.6-sol, gpt-5.6-luna, gpt-6-sol); `effort` is passed as thinkingLevel when it is auto, low, medium, high or xhigh. Otherwise QM's defaults apply.

Plan and QM API notes: docs/lanes/qm-plan.md.
