"""Forge pipeline for one unit type: synthetic data, SFT on River, eval, serve.

Run by services/forge as a child process. Prints one JSON object per line on
stdout, each a partial update of the type record:
  {"status", "progress", "stage", "examples", "evalScore", "model"}
Logs go to stderr. Never prints the API key.

Usage:
  python -m forge.pipeline --type-id refund-ranger --name "Refund Ranger" \
      --description "..." --out runs/refund-ranger [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from forge import datagen, env

env.load()


def emit(**update) -> None:
    print(json.dumps(update), flush=True)


def log(msg: str) -> None:
    print(f"[pipeline] {msg}", file=sys.stderr, flush=True)


def stage_generate(args, out: Path, dry: bool) -> tuple[list[dict], list[dict]]:
    emit(status="generating", progress=0.02, stage="reading the world from the brain")
    world = datagen.load_world(args.brain_url)
    emit(status="generating", progress=0.05, stage=f"world: {len(world['targets'])} issues, {len(world['components'])} components")
    spec = datagen.TypeSpec(args.type_id, args.name, args.description)
    n_eval = max(12, args.examples // 5)
    train_p, eval_p = datagen.build_split(spec, world, args.examples - n_eval, n_eval, seed=args.seed)
    prompts = train_p + eval_p
    contexts = {} if dry else datagen.load_contexts(args.brain_url, world)
    teacher = None if dry else datagen.RiverTeacher.from_env(args.teacher_model)
    users = [datagen.user_message(p["order"], contexts.get(p["meta"]["targetId"], "")) for p in prompts]
    responses: list[str | None] = [None] * len(prompts)
    fallbacks = 0
    if teacher is not None:
        emit(status="generating", progress=0.06, stage=f"teacher {args.teacher_model} writing {len(prompts)} examples")
        done = 0
        with ThreadPoolExecutor(max_workers=16) as pool:
            futs = {pool.submit(teacher.respond, spec, u): i for i, u in enumerate(users)}
            for f in as_completed(futs):
                i = futs[f]
                try:
                    responses[i] = f.result()
                except Exception as e:
                    log(f"teacher failed on example {i}: {type(e).__name__}: {str(e)[:120]}")
                done += 1
                if done % 8 == 0 or done == len(prompts):
                    emit(status="generating", progress=0.06 + 0.24 * done / len(prompts),
                         stage=f"teacher wrote {done}/{len(prompts)} examples", examples=done)
    rows: list[dict] = []
    for i, p in enumerate(prompts):
        response = responses[i]
        if response is None:
            if teacher is not None:
                fallbacks += 1
            response = datagen.template_response(spec, p, world)
            if dry:
                time.sleep(args.dry_seconds * 0.25 / max(1, len(prompts)))
                if i % 5 == 0 or i == len(prompts) - 1:
                    emit(status="generating", progress=0.05 + 0.25 * (i + 1) / len(prompts),
                         stage="writing examples (template)", examples=i + 1)
        rows.append({"messages": [
            {"role": "system", "content": datagen.system_prompt(spec)},
            {"role": "user", "content": users[i]},
            {"role": "assistant", "content": response},
        ], "meta": p["meta"]})
    if fallbacks:
        log(f"{fallbacks} examples fell back to the template generator")
    train, evalset = rows[:len(train_p)], rows[len(train_p):]
    out.mkdir(parents=True, exist_ok=True)
    for name, data in (("train.jsonl", train), ("eval.jsonl", evalset)):
        with open(out / name, "w") as f:
            for r in data:
                f.write(json.dumps(r) + "\n")
    emit(status="generating", progress=0.3, stage=f"{len(train)} train, {len(evalset)} held out", examples=len(rows))
    return train, evalset


def stage_train_dry(args) -> str:
    steps = 20
    for s in range(steps):
        time.sleep(args.dry_seconds * 0.5 / steps)
        loss = 2.4 * (0.93 ** s) + 0.2
        emit(status="training", progress=0.3 + 0.5 * (s + 1) / steps, stage=f"dry run: SFT step {s + 1}/{steps} loss {loss:.2f}")
    return f"dry-run:{args.type_id}"


def stage_eval_dry(args, evalset) -> None:
    n = len(evalset)
    for i in range(n):
        time.sleep(args.dry_seconds * 0.25 / max(1, n))
        if i % 3 == 0 or i == n - 1:
            emit(status="evaluating", progress=0.8 + 0.18 * (i + 1) / n, stage=f"dry run: held-out prompt {i + 1}/{n}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type-id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--dry-seconds", type=float, default=60.0)
    ap.add_argument("--examples", type=int, default=160)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--brain-url", default=os.environ.get("BRAIN_URL", "http://127.0.0.1:4616"))
    ap.add_argument("--teacher-model", default=os.environ.get("FORGE_TEACHER_MODEL", "Qwen/Qwen3.5-122B-A10B-FP8"))
    ap.add_argument("--base-model", default=os.environ.get("FORGE_BASE_MODEL", "Qwen/Qwen3.5-9B"))
    args = ap.parse_args()
    out = Path(args.out)
    dry = args.dry_run
    try:
        train, evalset = stage_generate(args, out, dry)
        if dry:
            model = stage_train_dry(args)
            stage_eval_dry(args, evalset)
            emit(status="ready", progress=1.0, stage="dry run: ready (no real training, no eval score)", model=model, evalScore=None)
            return 0
        from forge import train as river_train
        model = river_train.sft(args, train, out, emit)
        score, base_score = river_train.evaluate(args, evalset, model, out, emit)
        emit(status="ready", progress=1.0, stage=f"ready: eval {score:.2f} vs base {base_score:.2f}", model=model, evalScore=score,
             baseModel=args.base_model)
        return 0
    except Exception as e:  # report and exit non-zero; the service marks the type failed
        log(f"failed: {type(e).__name__}: {e}")
        emit(status="failed", stage=f"failed: {type(e).__name__}: {str(e)[:160]}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
