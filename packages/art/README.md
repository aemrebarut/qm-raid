# @qm-raid/art

Procedural low-poly Three.js asset factories for the QM Raid board: units, monsters, buildings, terrain, props, lighting and effects. Original assets only, built in code. No game logic; imports `three` only.

- Showroom: `bun run showroom` serves http://127.0.0.1:4620 (every asset, animation and effect on a turntable; `?area=units`, `?focus=Knight`, `?board=1` for the board camera). `GET /health` returns `{"ok": true, "service": "art"}`.
- Checks: `bun run typecheck && bun test test/`.
- One copy of three: `node_modules` is a symlink to `../../apps/board/node_modules` (created by `scripts/link.sh`, which every script runs), so the board and the showroom resolve the same three. Do not install packages here.
- API: `src/types.ts` (handles and conventions), `src/index.ts` (exports). Plan and owners: `docs/lanes/art-plan.md`.
