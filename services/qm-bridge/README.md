# qm-bridge

Implements the Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 against a local QM dev instance: one QM session per unit, run events streamed as Bridge events on GET /events, GBrain MCP tool calls normalized to `gbrain.<op>`.

QM access goes through the dev portal (`QM_PORTAL_URL`, default http://localhost:8129). Its loopback auth bypass (`PORTAL_LOCAL_AUTH_BYPASS`, local dev only) relays `/api/turn`, `/api/runs/:id`, `/api/runs/:id/events` and `/api/sessions/:id` to QM core with the portal's own signing, so this service holds no QM secrets. Non-GET requests send `origin: <portal url>`.

Run: QM up first (`cd qm && HARNESS=codex bash scripts/dev-instance.sh up --surface web`), then `bun run dev`. Smoke: `bun run smoke` (one QM turn, prints status, sessionId, reply), `bun run bridge-smoke` (Bridge API end to end).

Files:
- `src/server.ts`: Bridge API on 127.0.0.1:4614 (health, units, send, patch, delete, SSE /events). One stable QM conversation per unit (threadRef `web:<principal>:raid-<QM_THREAD_NS>-<unitId>`, kept across respawn, engine reset and bridge restart; DELETE keeps it), one active run per unit with a FIFO queue, an intro turn when the conversation is new and a "New round" marker turn when a deleted unit is spawned again (both streamed as chat, never terminal), exactly one terminal `reply` or `error` per send, decided from GET /api/runs/:id (never from RUN_FINISHED alone).
- `src/qm.ts`: QM client over the portal (principal, startTurn, getRun, waitRun, findSessionId, archiveSession, sessionUrl = QM web UI `/s/<sessionId>`).
- `src/tools.ts`: tool name normalization (`gbrain_search` -> `gbrain.search`; built-ins as `skills.read`, `memory.rewrite`).
- `src/loadout.ts`: Loadout (docs/CONTRACT.md). `GET /catalog` = QM skills from portal `/api/skills` (published, not shadowed; id = skill name, which QM's skills tool loads by) plus MCP servers if QM lists them (no HTTP list today, so GBrain only), cached 30 s, fixed fallback [raid-board, gbrain] when QM is down. `PATCH /units/:id` {team?, loadout?, model?, effort?} -> {ok, loadout, model, effort, sessionUrl}; `POST /units` also takes an optional loadout. QM has no per-session prompt, skill or MCP allowlist without core changes, so a changed loadout queues one visible 'Loadout changed' marker turn in the unit's stable conversation (behind any active order, no terminal event), and every order restates `Standing orders: ...` (up to 800 chars) and `Loadout: skills ... | plugins ...` after its header line. Plugins are honored through the standing orders only; GBrain is always on. Plan B behind `LOADOUT_SOUL=1` (or `LOADOUT_SOUL=<unit id prefix>`, e.g. `qmtest-`, to try it on test units only; default off; test on qmtest-* units, switch needs the Analyst's go plus a `QM_THREAD_NS` bump): each unit gets its own QM project (POST /api/projects, name '<name> (<id>)', kept in .state across DELETE), every turn passes its `scopeId` (group:web-project-<id>), and a loadout change is a marker turn that has the agent write its scope SOUL with its own capability token (content base64, env names only); applied only when the run shows HTTP 200. Group-scope turns end `silent`: the reply is the agent's last `web` post (finish_silently is hidden; silent without a post is an error terminal).
- `test/smoke.ts`: M1 smoke, one turn "Say hello in five words".
- `test/bridge-smoke.ts`: spawn, one order, wait for its terminal event, delete.
- `test/qm.test.ts`: unit tests with a fetch fixture (`bun test`).

Usage: QM exposes only org-wide spend (portal `/admin/api/spend`), so every 5 s the bridge splits the token delta across units that had a run in the last 15 s and emits `usage {unitId, tokens, usd}`. usd is what QM reports (0 on the ChatGPT OAuth harness). Approximate per unit, right in total.

Model and effort: `model` is passed to QM only when it is one of the Codex models QM allows (GET /api/runtime-config modelsByHarness.codex, for example gpt-5.6-sol, gpt-5.6-luna, gpt-6-sol); `effort` is passed as thinkingLevel when it is auto, low, medium, high or xhigh. Otherwise QM's defaults apply.

Plan and QM API notes: docs/lanes/qm-plan.md.
