# board (apps/board)

The QM Raid 2.5D isometric board: Vite + TypeScript + three.js. Talks only to the engine (via the /api proxy).

- Run: `bun install && bun run dev` (http://127.0.0.1:4611, proxies /api to http://127.0.0.1:4610; override with `ENGINE_URL`).
- Health: `curl 127.0.0.1:4611/health` -> `{"ok":true,"service":"board"}`.
- Test: `bun test test/` (core store, bus, fixture). Typecheck: `bun run typecheck`.
- Engine down: the board shows the synthetic fixture (`src/core/fixture.ts`) and keeps retrying SSE.
- Debug in the browser console: `raid.store.getState()`, `raid.bus.select(["u1"])`, `raid.api.state()`.

Layout: `src/core/` (store, API client, SSE, fixture, bus; raid-ui-plan), `src/scene/` (three.js world; raid-ui-scene, entry `mountScene(el, store, bus)`), `src/hud/` (DOM overlays; raid-ui-hud, entry `mountHud(el, store, bus)`).
