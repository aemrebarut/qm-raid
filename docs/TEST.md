# How to test each milestone (lanes append here)

## M1 river (forge, 4612)
`cd services/forge && bun run dev`, then `bun run smoke` (PASS). Manual: `curl -s -XPOST 127.0.0.1:4612/types -H 'content-type: application/json' -d '{"name":"Refund Ranger","description":"triages billing refund bugs and replies in the house tone"}'` then `curl -s 127.0.0.1:4612/types` a few times: status goes generating, training, evaluating, ready over about 60 s (dry run: model dry-run:<id>, evalScore null). Synthetic data lands in river/runs/<id>/train.jsonl.

## M1 qm (raid-qm-plan)
QM runs as shipped from `qm/` (gitignored clone): `cd qm && HARNESS=codex bash scripts/dev-instance.sh up --surface web` (status: `bash scripts/dev-instance.sh status`). Dev slot pool1: portal http://localhost:8129 (admin /admin/), core http://localhost:8081. Model: Codex harness on Emre's ChatGPT OAuth; no keys in the repo, no secrets needed by our code (portal loopback auth bypass, principal emre).
Test: `QM_PORTAL_URL=http://localhost:8129 bun services/qm-bridge/test/smoke.ts` prints `status: ok`, a sessionId and a five-word hello from a real Codex model (about 5 s). Calls: POST /api/turn {text, threadRef} (origin header) -> runId; GET /api/runs/:id -> {status, result:{sessionId, reply}}. Codex models QM allows: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-6-astra, gpt-6-sol, gpt-6-luna; effort auto/low/medium/high/xhigh.
