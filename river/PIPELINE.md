# Forge pipeline (river/)

One run per forged unit type, started by services/forge as `python -m forge.pipeline` in this folder. It prints JSON progress lines that the service merges into the type record served by `GET /types`.

1. generating (progress 0 to 0.3): read the world from the brain service (`GET /world`, built-in fallback if down). Build about 160 orders on Lumen issues in the engine's phrasing, weighted toward issues matching the type's description. Responses: a River teacher model via `client.chat_complete` (`FORGE_TEACHER_MODEL`) when the key is set, else a local template generator in the type's voice (plan, decision, customer reply, one learning). Chat-format rows with the type's system prompt; 80/20 split into `runs/<id>/train.jsonl` and `eval.jsonl`.
2. training (0.3 to 0.8): LoRA SFT on a small base (`FORGE_BASE_MODEL`, default Qwen/Qwen3.5-9B) with `session.create_model(base_model, lora=LoraConfig(rank=16))`, `model.train_step(data, lr)` over a few epochs with loss masked to the assistant turn, then `model.save_weights(name, mode="inference")` for a `river://` checkpoint.
3. evaluating (0.8 to 1.0): the held-out prompts through the trained checkpoint (`chat_complete_from_checkpoint`) and the base model (`chat_complete`), scored on the same rubric (the reply has the required sections, names the issue and customer, stays on the type's job). `evalScore` = trained score; the base score is in the stage text and `runs/<id>/eval.json`.
4. ready: `model` = the checkpoint path. Forge units (Bridge API on 4612) run a small agent loop on it: recall from the brain before, answer, remember after.

Dry run (`FORGE_MODE` unset or `dry`): step 1 runs for real with the template generator; steps 2 and 3 are simulated over about 60 s; `model` = `dry-run:<id>`, `evalScore` = null (no fake numbers).

Check access: `RIVER_API_KEY=... .venv/bin/python -m forge.capabilities` (prints model names only).
