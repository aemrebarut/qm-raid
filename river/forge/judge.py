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


GRADE = re.compile(r"^\s*(0(?:\.0)?|0?\.5|1(?:\.0)?)\s*\.?\s*$")
MIN_COVERAGE = 0.9  # share of eval rows that need a grade for both models before a blended score is published


def judge_one(client, model: str, user: str, answer: str) -> float:
    res = client.chat_complete([{"role": "user", "content": JUDGE.format(user=user[:4000], answer=answer[:3000])}],
                               base_model=model, max_tokens=8, temperature=0.0,
                               chat_template_kwargs={"enable_thinking": False}, timeout=120)
    text = json.loads(res.response_json)["choices"][0]["message"]["content"] or ""
    m = GRADE.match(text)
    if not m:  # an unparsable or off-rubric grade is unavailable, never a zero
        raise ValueError(f"invalid grade {text[:20]!r}")
    return float(m.group(1))


def judge_eval(out: Path, model: str, emit=None) -> tuple[float | None, float | None, int, int]:
    env.load()
    import river_client as river
    client = river.Client(api_key=os.environ["RIVER_API_KEY"])
    d = json.loads((out / "eval.json").read_text())
    jobs = []  # eval rows store the full user turn (order plus recalled context)
    for i, r in enumerate(d["rows"]):
        jobs += [(i, "trained", r["order"], r["trained"]), (i, "base", r["order"], r["base"])]

    def run(job):
        i, who, user, ans = job
        for attempt in (1, 2):
            try:
                return i, who, judge_one(client, model, user, ans)
            except Exception as e:
                print(f"[judge] {who} {i} attempt {attempt} failed: {type(e).__name__}: {str(e)[:80]}", file=sys.stderr)
        return i, who, None

    with ThreadPoolExecutor(max_workers=16) as pool:
        for i, who, s in pool.map(run, jobs):
            d["rows"][i][f"{who}Grounded"] = s
    # Compare the models on the same rows only, and only with enough coverage; otherwise the eval is incomplete.
    pairs = [r for r in d["rows"] if r.get("trainedGrounded") is not None and r.get("baseGrounded") is not None]
    complete = bool(d["rows"]) and len(pairs) >= MIN_COVERAGE * len(d["rows"])
    d["trainedGrounded"] = round(sum(r["trainedGrounded"] for r in pairs) / len(pairs), 3) if complete else None
    d["baseGrounded"] = round(sum(r["baseGrounded"] for r in pairs) / len(pairs), 3) if complete else None
    d["judgedPairs"], d["judge"] = len(pairs), model
    (out / "eval.json").write_text(json.dumps(d, indent=2))
    return d["trainedGrounded"], d["baseGrounded"], len(pairs), len(d["rows"])


if __name__ == "__main__":
    out = Path(sys.argv[1])
    print(judge_eval(out, os.environ.get("FORGE_TEACHER_MODEL", "Qwen/Qwen3.5-122B-A10B-FP8")))
