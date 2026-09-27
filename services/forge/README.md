# forge (River building), port 4612

Trains new unit types. `POST /types {name, description}` starts the pipeline in `river/` (synthetic data from the brain world, SFT on River, eval vs base, serve); `GET /types` reports progress. Forge units will implement the Bridge API on this port (M3).

Run: `bun run dev` (needs `river/.venv`: `cd river && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python river-client`).
Smoke: `bun run smoke` while the service runs.

Env: `FORGE_MODE=dry|river` (default river when `RIVER_API_KEY` is set, e.g. in `services/forge/.env` (gitignored, Bun loads it; river/forge/env.py reads the same file), else dry. Dry: real synthetic data, fake training over `FORGE_DRY_SECONDS`, default 60, model `dry-run:<id>`, evalScore null). `river` needs `RIVER_API_KEY` (set by Emre, never logged), `FORGE_BASE_MODEL`, `FORGE_TEACHER_MODEL`. `BRAIN_URL` default http://127.0.0.1:4616 (falls back to a built-in world if down).
State: `river/runs/types.json` and `river/runs/<typeId>/{train,eval}.jsonl` (gitignored).
