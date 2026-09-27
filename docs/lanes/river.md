# Lane River: the commander model (River AI quest)
Agent: raid-river (lead and implementer), reviewed by raid-rev (tell it after commits). Owns `river/` and `services/commander/`.
River docs: https://docs.river.ai/ (Python `river-client`; SFT, RL, distillation; models such as Qwen/Qwen3.5-9B; access depends on the key; `client.get_capabilities()`). The key is `RIVER_API_KEY`; Emre sets it himself; never print it.

Goal: a small commander model that takes the Proposer API input (docs/CONTRACT.md) and returns proposals, trained on synthetic situations and the user's real vetoes (data/vetoes.jsonl).
- First step (now): `river/` Python project (venv), install `river-client`, fix the prompt and JSON output format, write a generator for about 200 synthetic situations with good proposals (severity first, same-component experience, idle units only, autopilot teams only, customer impact) plus a held-out set, and train and eval scripts. Ask the Analyst for the key when ready to run.
- M2/M3: first tiny SFT (or distillation) run end to end; eval proposal accuracy on held-out vs the base model with the same prompt; include real vetoes as they appear.
- M4: `services/commander` on 127.0.0.1:4612 serving POST /propose with the trained model (and GET /health), so the engine switches with PROPOSER_URL. Report honest numbers even if the base model wins.
