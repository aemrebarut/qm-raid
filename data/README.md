# data/ (owned by raid-eng-plan)

Runtime files written by services. All `*.jsonl` here are gitignored (synthetic, local only).

- `vetoes.jsonl`: one row per resolved autopilot proposal, written by the engine, read by raid-river. Row shape in docs/CONTRACT.md, "Veto log". Engine path override: `VETO_LOG`.
