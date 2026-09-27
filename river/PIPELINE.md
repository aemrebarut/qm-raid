# Forge pipeline (river/)

One run per forged unit type, started by services/forge as `python -m forge.pipeline` in this folder. It prints JSON progress lines that the service merges into the type record served by `GET /types`.

1. generating (progress 0 to 0.3): read the world from the brain service (`GET /world`, built-in fallback if down). Build about 160 orders on Lumen issues in the engine's phrasing, weighted toward issues matching the type's description. Each order gets the brain's recall context for its issue (read-only `POST /recall`), in the same format forge units see at serve time. Responses: a River teacher (`FORGE_TEACHER_MODEL`, default Qwen/Qwen3.5-122B-A10B-FP8, 16 parallel `chat_complete` calls) writing under a long house style guide (`datagen.teacher_prompt`: five headings, concise, warm reply to the named contact, one lesson), else the local template generator. Rows are stored with only the short unit prompt (`datagen.system_prompt`), so SFT distills the style guide into the weights (context distillation). Train and eval use disjoint phrasings (overlap asserted): 128 train, 32 held out.
2. training (0.3 to 0.8): LoRA SFT on a small base (`FORGE_BASE_MODEL`, default Qwen/Qwen3.5-9B) with `session.create_model(base_model, lora=LoraConfig(rank=16))`, `model.train_step(data, lr)` over a few epochs with loss masked to the assistant turn, then `model.save_weights(name, mode="inference")` for a `river://` checkpoint.
3. evaluating (0.8 to 1.0): the held-out prompts through the trained checkpoint (`chat_complete_from_checkpoint`) and the base model (`chat_complete`), both with the same short unit prompt, scored on the same deterministic rubric: the five headings (0.5), names the issue (0.1), the customer (0.1), the component (0.05), concise (0.25, full at 1000 chars or less, 0 at 2000). `evalScore` = trained score; the base score is in the stage text and `runs/<id>/eval.json`.
4. ready: `model` = the checkpoint path. Forge units (Bridge API on 4612) run a small agent loop on it: recall from the brain before, answer, remember after.

Dry run (`FORGE_MODE` unset or `dry`): step 1 runs for real with the template generator; steps 2 and 3 are simulated over about 60 s; `model` = `dry-run:<id>`, `evalScore` = null (no fake numbers).

Check access: `RIVER_API_KEY=... .venv/bin/python -m forge.capabilities` (prints model names only).

Run 1 (15:05, style guide in the prompt for both models): trained 0.81 vs base 0.81, no gain, since the base already follows an explicit guide. Run 2 moves the guide into the weights.

## Reviewer profile (Rule Warden, forge/warden.py)
A type whose name or description mentions review, judge or verdict trains as a workflow reviewer or judge.
- Orders: the engine's workflow order as a forge unit sees it (order header, `Role: reviewer.` or `Role: judge.` with the engine's own instructions, `Previous work:` with one implementer, or a planner plus implementer, or two implementers for a judge).
- Changes: 13 Lumen house rules as the brain states them (components/<id> House rules and rules/* pages). Each rule has one change that follows it and one that breaks it, so the right verdict (APPROVED, CHANGES, or APPROVED (winner: uX)) is known.
- Teacher: the same short unit prompt plus the review format (Rules:, Finding:, final VERDICT line) and a hidden key with the rule and the correct verdict. The student never sees the key. A teacher review is kept only if it ends with a valid VERDICT line, gets the verdict or winner right and cites the rule slug; otherwise a checked template replaces it.
- Split: one rule per component is held out (billing-tz, auth-refresh, onb-mailer, search-scope). Eval orders use only held-out rules, so the eval measures applying a rule read from the brain context, not remembering a verdict. The held-out judge rows are all one-good-one-bad (no both-wrong case).
- Eval: style (valid final VERDICT line, cites the slug, Rules and Finding lines, concise), verdict accuracy against the known key (engine semantics: the last VERDICT line decides), and groundedness (same judge). evalScore = mean of the three; GET /types/:id/eval shows each.
- Recall budget: 3500 characters instead of 1500 (runs/<id>/profile.json, read by serve.py), because past learnings come first in the recall context and the house rules must still fit.
