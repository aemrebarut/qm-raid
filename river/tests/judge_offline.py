"""Offline judge test (reviewer P2): unavailable or off-rubric grades never become published zeros.
Run: cd river && .venv/bin/python -m tests.judge_offline (no River calls: the grader is faked)."""
import json
import os
import tempfile
from pathlib import Path

os.environ["RIVER_API_KEY"] = "offline-test"  # set first, so env.load() never reads the real key
import river_client
river_client.Client = lambda **k: None
from forge import judge

for text, want in [("1", 1.0), ("0.5", 0.5), (".5", 0.5), (" 1.0.", 1.0), ("0", 0.0),
                   ("0.7", None), ("Score: 1", None), ("2", None), ("", None)]:
    m = judge.GRADE.match(text)
    assert (float(m.group(1)) if m else None) == want, (text, m)


def run(grade) -> tuple:
    out = Path(tempfile.mkdtemp())
    (out / "eval.json").write_text(json.dumps({"rows": [{"order": f"o{i}", "trained": f"t{i}", "base": f"b{i}"} for i in range(10)]}))
    judge.judge_one = lambda client, model, user, ans: grade(user, ans)
    return judge.judge_eval(out, "fake"), json.loads((out / "eval.json").read_text())


def boom(user, ans):
    raise TimeoutError("judge down")


(res, d) = run(boom)
assert res == (None, None, 0, 10) and d["trainedGrounded"] is None, res
(res, d) = run(lambda u, a: 1.0 if a.startswith("t") else 0.5)
assert res == (1.0, 0.5, 10, 10), res
(res, d) = run(lambda u, a: boom(u, a) if a in ("b1", "b2") else 1.0)  # 8 of 10 pairs: below coverage
assert res == (None, None, 8, 10), res
flaky = set()
def once(u, a):  # first call per answer fails, the retry succeeds
    if a not in flaky:
        flaky.add(a)
        raise TimeoutError("blip")
    return 1.0
(res, d) = run(once)
assert res == (1.0, 1.0, 10, 10), res
print("PASS")
