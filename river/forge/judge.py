"""Groundedness judge: does an answer stay true to the team brain context it was given?

The rubric in train.py measures house style; this measures honesty. The teacher model reads the
recalled context and one answer (trained or base, blind to which) and returns a 0..1 score.
Run on an existing eval: python -m forge.judge runs/<typeId>
"""
from __future__ import annotations

import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from forge import env

JUDGE = """You grade an agent's answer for groundedness. The agent was given an order and the team brain context below.
Score 1.0 if every house rule, fact and customer detail the answer states is supported by the order or the context.
Score 0.5 if it adds minor unsupported details. Score 0.0 if it invents a house rule, a policy, or facts that contradict the context.
Style and format do not matter. Reply with only the number.

ORDER AND CONTEXT:
{user}

ANSWER:
{answer}"""


def judge_one(client, model: str, user: str, answer: str) -> float:
    res = client.chat_complete([{"role": "user", "content": JUDGE.format(user=user[:4000], answer=answer[:3000])}],
                               base_model=model, max_tokens=8, temperature=0.0,
                               chat_template_kwargs={"enable_thinking": False}, timeout=120)
    text = json.loads(res.response_json)["choices"][0]["message"]["content"]
    m = re.search(r"[01](?:\.\d+)?", text)
    return max(0.0, min(1.0, float(m.group(0)))) if m else 0.0


def judge_eval(out: Path, model: str, emit=None) -> tuple[float, float]:
    env.load()
    import river_client as river
    client = river.Client(api_key=os.environ["RIVER_API_KEY"])
    d = json.loads((out / "eval.json").read_text())
    jobs = []  # eval rows store the full user turn (order plus recalled context)
    for i, r in enumerate(d["rows"]):
        jobs += [(i, "trained", r["order"], r["trained"]), (i, "base", r["order"], r["base"])]

    def run(job):
        i, who, user, ans = job
        try:
            return i, who, judge_one(client, model, user, ans)
        except Exception as e:
            print(f"[judge] {who} {i} failed: {type(e).__name__}", file=sys.stderr)
            return i, who, None

    with ThreadPoolExecutor(max_workers=16) as pool:
        for i, who, s in pool.map(run, jobs):
            d["rows"][i][f"{who}Grounded"] = s
    tg = [r["trainedGrounded"] for r in d["rows"] if r.get("trainedGrounded") is not None]
    bg = [r["baseGrounded"] for r in d["rows"] if r.get("baseGrounded") is not None]
    d["trainedGrounded"] = round(sum(tg) / len(tg), 3) if tg else None
    d["baseGrounded"] = round(sum(bg) / len(bg), 3) if bg else None
    d["judge"] = model
    (out / "eval.json").write_text(json.dumps(d, indent=2))
    return d["trainedGrounded"], d["baseGrounded"]


if __name__ == "__main__":
    out = Path(sys.argv[1])
    print(judge_eval(out, os.environ.get("FORGE_TEACHER_MODEL", "Qwen/Qwen3.5-122B-A10B-FP8")))
