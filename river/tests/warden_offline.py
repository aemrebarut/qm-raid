"""Offline Rule Warden checks (no River, no brain): strict judge winners, disjoint split, templates agree with the key.
Run: cd river && .venv/bin/python -m tests.warden_offline"""
from forge import datagen, warden

m = {"verdict": "APPROVED", "winner": "u3", "cites": ["components/billing"]}
head = "Rules: components/billing\nFinding: x.\n"
for last, want in [("VERDICT: APPROVED (winner: u2; u3 is rejected)", 0.0), ("VERDICT: APPROVED (winner: u3; u2 is rejected)", 1.0),
                   ("VERDICT: APPROVED (winner: u2 or u3)", 0.0), ("VERDICT: APPROVED (winner: u3, winner: u2)", 0.0), ("VERDICT: APPROVED (winner: u3, u2)", 0.0),
                   ("VERDICT: APPROVED (winner: u3)", 1.0), ("VERDICT: APPROVED", 0.0), ("VERDICT: CHANGES: both break it", 0.0)]:
    assert warden.verdict_correct(head + last, m) == want, last
    assert warden.agrees(head + last, m) == (want == 1.0), last

world = datagen.FALLBACK_WORLD
train, evals = warden.build_split(world, 128, 32, 7)
assert train and evals and not {p["order"] for p in train} & {p["order"] for p in evals}
rules = {r["id"]: r for r in warden.RULES}
for p in train + evals:
    assert warden.agrees(warden.template(p["meta"], rules), p["meta"]), p["meta"]
print("PASS")
