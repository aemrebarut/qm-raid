"""Real River path: LoRA SFT on the synthetic data, then an honest eval (trained vs base).

The rubric is deterministic and the same for both models: the held-out orders use
phrasings never seen in training, and both models get the same system prompt
(which states the required headings), so the base model is not handicapped.
"""
from __future__ import annotations

import json
import math
import os
import random
import time
from pathlib import Path

HEADINGS = ["Recall:", "Plan:", "Decision:", "Customer reply:", "Remember:"]


def client():
    import river_client as river
    return river.Client(api_key=os.environ["RIVER_API_KEY"])


def _renderer(base_model: str):
    from river_client.renderers import get_renderer
    return get_renderer(base_model, thinking=False)


def score(text: str, meta: dict, customers: list[str]) -> float:
    """0..1: required headings (0.5), names the issue (0.15), the customer (0.15), the component (0.1), sane length (0.1)."""
    s = 0.1 * sum(1 for h in HEADINGS if h.lower() in text.lower())
    s += 0.15 if meta["issue"].lower() in text.lower() else 0.0
    if not customers or any(c.lower() in text.lower() for c in customers):
        s += 0.15
    s += 0.1 if meta["component"].lower() in text.lower() else 0.0
    s += 0.1 if 150 <= len(text) <= 1500 else 0.0
    return round(s, 4)


def sft(args, train: list[dict], out: Path, emit) -> str:
    import river_client as river
    t0 = time.time()
    emit(status="training", progress=0.31, stage=f"tokenizing for {args.base_model}")
    r = _renderer(args.base_model)
    data = [r.build_training_example(row["messages"]).to_dict() for row in train]
    epochs = int(os.environ.get("FORGE_EPOCHS", "3"))
    batch = int(os.environ.get("FORGE_BATCH", "16"))
    lr = float(os.environ.get("FORGE_LR", "2e-4"))
    steps_per_epoch = math.ceil(len(data) / batch)
    total = epochs * steps_per_epoch
    c = client()
    emit(status="training", progress=0.32, stage=f"waiting for a River session ({args.base_model}, LoRA r16)")
    timings = {"start": time.time()}
    with c.session(project="qm-raid-forge", timeout=float(os.environ.get("FORGE_SESSION_TIMEOUT", "600"))) as session:
        timings["session"] = time.time()
        emit(status="training", progress=0.325, stage=f"River session open after {timings['session'] - timings['start']:.0f} s; loading {args.base_model}")
        model = session.create_model(base_model=args.base_model, lora=river.LoraConfig(rank=16))
        timings["model"] = time.time()
        emit(status="training", progress=0.33, stage=f"model loaded after {timings['model'] - timings['session']:.0f} s; training")
        rng = random.Random(args.seed)
        step = 0
        losses = []
        for ep in range(epochs):
            order = list(range(len(data)))
            rng.shuffle(order)
            for b in range(steps_per_epoch):
                chunk = [data[i] for i in order[b * batch:(b + 1) * batch]]
                fb, _ = model.train_step(chunk, lr=lr, grad_clip_norm=1.0)
                step += 1
                loss = float(fb.metrics.get("loss", float("nan")))
                losses.append(loss)
                emit(status="training", progress=0.33 + 0.45 * step / total,
                     stage=f"SFT step {step}/{total} loss {loss:.3f}")
        emit(status="training", progress=0.79, stage="saving checkpoint")
        ckpt = model.save_weights(args.type_id, mode="inference")
    info = {"checkpoint": ckpt.path, "base_model": args.base_model, "steps": total, "epochs": epochs,
            "batch": batch, "lr": lr, "losses": losses, "train_examples": len(data), "seconds": round(time.time() - t0, 1),
            "sessionWait": round(timings["session"] - timings["start"], 1), "modelLoad": round(timings["model"] - timings["session"], 1)}
    (out / "model.json").write_text(json.dumps(info, indent=2))
    return ckpt.path


def evaluate(args, evalset: list[dict], checkpoint: str, out: Path, emit) -> tuple[float, float]:
    t0 = time.time()
    r = _renderer(args.base_model)
    stops = r.get_stop_strings()
    c = client()
    rows = []
    kw = dict(base_model=args.base_model, max_tokens=400, temperature=0.0, stop=stops)
    with c.session(project="qm-raid-forge-eval") as session:
        for b in range(0, len(evalset), 8):
            chunk = evalset[b:b + 8]
            prompts = [r.build_sample_prompt(row["messages"][:-1]).prompt for row in chunk]
            trained = session.sample(prompts, checkpoint=checkpoint, **kw)
            base = session.sample(prompts, **kw)
            for row, tr, bs in zip(chunk, trained, base):
                cust = row["meta"].get("customers", [])
                rows.append({"order": row["messages"][1]["content"], "trained": tr[0].text, "base": bs[0].text,
                             "trainedScore": score(tr[0].text, row["meta"], cust), "baseScore": score(bs[0].text, row["meta"], cust)})
            emit(status="evaluating", progress=0.8 + 0.18 * len(rows) / len(evalset), stage=f"held-out prompts {len(rows)}/{len(evalset)} (trained and base)")
    ts = sum(x["trainedScore"] for x in rows) / len(rows)
    bs = sum(x["baseScore"] for x in rows) / len(rows)
    (out / "eval.json").write_text(json.dumps({"trained": ts, "base": bs, "n": len(rows), "seconds": round(time.time() - t0, 1),
                                               "rows": rows}, indent=2))
    return round(ts, 3), round(bs, 3)
