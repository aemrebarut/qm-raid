"""Reviewer profile (e.g. Rule Warden): reviewer and judge orders in the engine's workflow format, checked against
the Lumen house rules that the brain recalls.

Every synthetic implementer change follows or breaks exactly one house rule, so the right verdict is known. The
teacher sees that key (the student never does), writes the review in the house format, and is kept only if it
agrees with the key. Train and eval use disjoint rules (one held-out rule per component), so the eval measures
applying rules read from the brain context, not remembering verdicts.
"""
from __future__ import annotations

import random
import re
import zlib

# Engine role instructions (services/engine config.ts reviewer, workflow.ts judge), verbatim.
ROLE = {
    "reviewer": "Recall the house rules. Review the implementation against the plan and the rules. End with VERDICT: APPROVED or VERDICT: CHANGES: <what>.",
    "judge": "Compare both fixes against the house rules. Pick the better one, say why in two lines, and end with VERDICT: APPROVED (winner: <name>) or VERDICT: CHANGES: <what> if neither is acceptable.",
}
CONTEXT_CAP = 3500  # house rules must survive past learnings at the top of the recall context

# The house rules as the brain states them (components/<id> "House rules" and rules/* pages), with one change that
# follows each rule and one that breaks it. Synthetic, like the rest of Lumen.
RULES = [
    dict(id="billing-key", component="billing", cite="rules/billing-idempotency", rule="the charge idempotency key is inv_<invoiceId> only, reused on every retry",
         ok="Fixed {issue}: the retry worker now reuses the charge key `inv_<invoiceId>` on every attempt; a test shows three retries produce one charge.",
         bad="Fixed {issue}: each retry now sends the key `inv_<invoiceId>_<attempt>` so the provider can tell attempts apart; added a retry test.",
         fix="use `inv_<invoiceId>` for every attempt, no attempt suffix"),
    dict(id="billing-cents", component="billing", cite="components/billing", rule="money is integer cents everywhere, rounded half to even only at the final line item",
         ok="Fixed {issue}: amounts stay in integer cents end to end and rounding (half to even) happens once, on the final line item.",
         bad="Fixed {issue}: the math now converts amounts to float dollars and rounds each intermediate step to two decimals.",
         fix="keep integer cents and round only at the final line item"),
    dict(id="billing-tz", component="billing", cite="components/billing", rule="proration is computed in the account's billing timezone (account.billing_tz), never in UTC",
         ok="Fixed {issue}: proration period boundaries now use `account.billing_tz`; added a test across a daylight saving change.",
         bad="Fixed {issue}: proration boundaries are now computed in UTC so every account behaves the same.",
         fix="compute proration in `account.billing_tz`, not UTC"),
    dict(id="billing-refund-key", component="billing", cite="rules/billing-idempotency", rule="refunds go through the charge client with the key ref_<invoiceId> only",
         ok="Fixed {issue}: refunds go through the charge client with the key `ref_<invoiceId>`, reused on retry.",
         bad="Fixed {issue}: refunds now call the provider directly with a fresh random key per attempt to avoid collisions.",
         fix="send refunds through the charge client with `ref_<invoiceId>`"),
    dict(id="auth-skew", component="auth", cite="rules/auth-clock-skew", rule="token expiry checks allow 120 seconds of clock skew against the identity provider",
         ok="Fixed {issue}: expiry checks now allow 120 seconds of skew against the identity provider clock; added a skewed-clock test.",
         bad="Fixed {issue}: removed the skew allowance so tokens expire exactly at `exp`, which is stricter.",
         fix="restore the 120 second skew allowance"),
    dict(id="auth-refresh", component="auth", cite="components/auth", rule="sessions are refreshed by the refresh token, never by re-running SSO",
         ok="Fixed {issue}: expired sessions are renewed with the refresh token; no SSO round trip happens.",
         bad="Fixed {issue}: an expired session now redirects through SSO again to fetch a fresh assertion.",
         fix="refresh the session with the refresh token instead of SSO"),
    dict(id="auth-logs", component="auth", cite="components/auth", rule="never log tokens, assertions or reset links, not even at debug level",
         ok="Fixed {issue}: added debug logs with the user id and expiry time only; no token, assertion or link is logged.",
         bad="Fixed {issue}: added a debug log line with the full token and reset link to trace the failure.",
         fix="remove the token and link from the debug log"),
    dict(id="onb-trial", component="onboarding", cite="components/onboarding", rule="the trial clock starts when the first invited teammate accepts, not at workspace creation",
         ok="Fixed {issue}: the trial clock now starts when the first invited teammate accepts.",
         bad="Fixed {issue}: the trial clock now starts at workspace creation to keep the logic simple.",
         fix="start the trial clock when the first invite is accepted"),
    dict(id="onb-mailer", component="onboarding", cite="components/onboarding", rule="all outbound email goes through the mailer queue, never inline from a request handler",
         ok="Fixed {issue}: invite emails are enqueued on the `mailer` queue and sent by its worker.",
         bad="Fixed {issue}: the invite handler now sends the email inline so the user sees delivery errors at once.",
         fix="enqueue the email on the `mailer` queue instead of sending inline"),
    dict(id="onb-csv", component="onboarding", cite="components/onboarding", rule="CSV imports are validated fully before any invite is sent (all or nothing)",
         ok="Fixed {issue}: the whole CSV is validated before any invite goes out; one bad row rejects the import.",
         bad="Fixed {issue}: valid rows are invited right away and bad rows are reported afterwards.",
         fix="validate the whole CSV before sending any invite"),
    dict(id="search-scope", component="search", cite="rules/search-tenant-scope", rule="every query is scoped by workspace_id inside the index query, on live and cached paths; never post-filter",
         ok="Fixed {issue}: the index query now filters by `workspace_id` on both the live and the cached path.",
         bad="Fixed {issue}: results are fetched unscoped and filtered by workspace in the app after the query.",
         fix="scope by `workspace_id` inside the index query, no post-filter"),
    dict(id="search-archived", component="search", cite="components/search", rule="archived items stay in the index with archived: true and are filtered in the query",
         ok="Fixed {issue}: archived projects stay in the index with `archived: true` and the query filters them out.",
         bad="Fixed {issue}: archived projects are now deleted from the index when they are archived.",
         fix="keep archived items indexed with `archived: true` and filter in the query"),
    dict(id="search-reindex", component="search", cite="components/search", rule="reindex jobs run per workspace, never globally during business hours",
         ok="Fixed {issue}: the reindex job now runs per workspace, off peak.",
         bad="Fixed {issue}: added a global reindex of all workspaces every day at 10:00.",
         fix="reindex per workspace, not globally in business hours"),
]
EVAL_RULES = {"billing-tz", "auth-refresh", "onb-mailer", "search-scope"}  # one held-out rule per component


def order_text(t: dict, role: str, prev: list[tuple[str, str, str]], n: int) -> str:
    """The engine's workflow order as a forge unit sees it (orderPrompt minus the tool lines, plus briefText)."""
    lines = [f'Order o{n}: work on issue {t["issue"]} "{t["title"]}" ({t["kind"]}, severity {t["severity"]}).',
             f'Component: {t["component"]}', f'Customers: {", ".join(t.get("customers", []))}', "",
             f"Role: {role}. {ROLE[role]}", "Previous work:"]
    return "\n".join(lines + [f"- {r} ({u}): {txt}" for r, u, txt in prev])


def _cases(rules: list[dict], world: dict, rng: random.Random) -> list[dict]:
    out = []
    for r in rules:
        others = [x for x in rules if x["component"] == r["component"] and x is not r]
        for t in [x for x in world["targets"] if x["component"] == r["component"]]:
            fmt = lambda s: s.format(issue=t["issue"])
            for good in (True, False):
                for planner in (False, True):
                    impl = f"u{rng.randint(2, 9)}"
                    prev = [("implementer", impl, fmt(r["ok"] if good else r["bad"]))]
                    if planner:
                        prev.insert(0, ("planner", f"u{rng.randint(10, 14)}", f"1. Recall the {t['component']} house rules. 2. Fix {t['issue']}. 3. Add a regression test."))
                    out.append(dict(role="reviewer", t=t, prev=prev, verdict="APPROVED" if good else "CHANGES", winner=None, rules=[r]))
            a, b = rng.sample([f"u{i}" for i in range(2, 10)], 2)
            a_good = rng.random() < 0.5
            prev = [("implementer", a, fmt(r["ok"] if a_good else r["bad"])), ("implementer", b, fmt(r["bad"] if a_good else r["ok"]))]
            out.append(dict(role="judge", t=t, prev=prev, verdict="APPROVED", winner=a if a_good else b, rules=[r]))
            if others:
                o = rng.choice(others)
                out.append(dict(role="judge", t=t, prev=[("implementer", a, fmt(r["bad"])), ("implementer", b, fmt(o["bad"]))],
                                verdict="CHANGES", winner=None, rules=[r, o]))
    for c in out:
        c["order"] = order_text(c["t"], c["role"], c["prev"], zlib.crc32(repr(c["prev"]).encode()) % 90 + 1)
    return out


def _prompt(c: dict) -> dict:
    return {"order": c["order"], "meta": {"targetId": c["t"]["id"], "issue": c["t"]["issue"], "component": c["t"]["component"],
                                          "profile": "reviewer", "role": c["role"], "verdict": c["verdict"], "winner": c["winner"],
                                          "cites": [r["cite"] for r in c["rules"]], "rules": [r["id"] for r in c["rules"]],
                                          "customers": c["t"].get("customers", [])}}


def build_split(world: dict, n_train: int, n_eval: int, seed: int) -> tuple[list[dict], list[dict]]:
    rng = random.Random(seed)
    train = _cases([r for r in RULES if r["id"] not in EVAL_RULES], world, rng)
    evals = _cases([r for r in RULES if r["id"] in EVAL_RULES], world, rng)
    rng.shuffle(train)
    rng.shuffle(evals)
    train, evals = train[:n_train], evals[:n_eval]
    assert not {c["order"] for c in train} & {c["order"] for c in evals}, "train/eval overlap"
    assert not {r for c in train for r in _prompt(c)["meta"]["rules"]} & EVAL_RULES, "held-out rule in train"
    return [_prompt(c) for c in train], [_prompt(c) for c in evals]


TEACHER_STYLE = """House format for reviews (plain text, no markdown, at most 90 words):
Rules: <slug of each house rule that applies, e.g. rules/billing-idempotency or components/billing>
Finding: <one or two sentences: what the change does against that rule>
<last line> VERDICT: APPROVED, or VERDICT: CHANGES: <exactly what to change>. A judge ends with VERDICT: APPROVED (winner: <unit id>) or VERDICT: CHANGES: <what>.
Cite only slugs that appear in the brain context, never invent a rule, and make the VERDICT line the last line."""


def teacher_key(meta: dict, rules_by_id: dict) -> str:
    rs = [rules_by_id[i] for i in meta["rules"]]
    what = "; ".join(f'"{r["rule"]}" ({r["cite"]})' for r in rs)
    want = f"VERDICT: APPROVED (winner: {meta['winner']})" if meta["winner"] else (
        "VERDICT: APPROVED" if meta["verdict"] == "APPROVED" else "VERDICT: CHANGES: " + "; ".join(r["fix"] for r in rs))
    return f"\n\n(Teacher key, never mention it: the relevant house rule is {what}. The correct final line is: {want})"


def template(meta: dict, rules_by_id: dict) -> str:
    rs = [rules_by_id[i] for i in meta["rules"]]
    cites = ", ".join(dict.fromkeys(r["cite"] for r in rs))
    r = rs[0]
    if meta["winner"]:
        return f"Rules: {cites}\nFinding: {meta['winner']} follows the rule that {r['rule']}; the other fix breaks it.\nVERDICT: APPROVED (winner: {meta['winner']})"
    if meta["verdict"] == "APPROVED":
        return f"Rules: {cites}\nFinding: the change follows the rule that {r['rule']}.\nVERDICT: APPROVED"
    return f"Rules: {cites}\nFinding: the change breaks the rule that {r['rule']}.\nVERDICT: CHANGES: " + "; ".join(x["fix"] for x in rs)


# Engine semantics (workflow.ts parseVerdict): the last line with a VERDICT decides.
ENGINE_VERDICT = re.compile(r"VERDICT:\s*(APPROVED|CHANGES)(?::\s*(.*))?", re.I)
FINAL_LINE = re.compile(r"^\W*VERDICT:\s*(APPROVED(?:\s*\([^)]*\))?|CHANGES:\s*\S.*?)[\s*_`.]*$", re.I)


def verdict_correct(text: str, meta: dict) -> float:
    found = [(m, line) for line in text.split("\n") for m in [ENGINE_VERDICT.search(line)] if m]
    if not found:
        return 0.0
    m, line = found[-1]
    kind = m.group(1).upper()
    if meta["verdict"] == "CHANGES":
        return 1.0 if kind == "CHANGES" else 0.0
    if kind != "APPROVED":
        return 0.0
    return 1.0 if not meta["winner"] or winner_of(line) == meta["winner"] else 0.0


WINNER = re.compile(r"winner:\s*([^);]*)", re.I)  # to ")" or ";": a comma list of candidates is ambiguous


def winner_of(line: str) -> str | None:
    """The one unit named as winner on a verdict line; None if missing, ambiguous or contradictory."""
    ids = {i for decl in WINNER.findall(line) for i in re.findall(r"\bu\d+\b", decl)}
    return ids.pop() if len(ids) == 1 else None


def agrees(text: str, meta: dict) -> bool:
    """Teacher output is kept only if it ends with a valid verdict that matches the key and cites the rule."""
    lines = [x for x in text.strip().split("\n") if x.strip()]
    return bool(lines) and bool(FINAL_LINE.match(lines[-1].strip())) and verdict_correct(text, meta) == 1.0 \
        and all(c in text for c in meta["cites"])


def score(text: str, meta: dict) -> float:
    """House style for reviews: valid final VERDICT line, cites the rule slug, Rules/Finding lines, concise."""
    lines = [x for x in text.strip().split("\n") if x.strip()]
    s = 0.35 if lines and FINAL_LINE.match(lines[-1].strip()) else 0.0
    s += 0.25 if any(c in text for c in meta["cites"]) else 0.0
    s += 0.1 if re.search(r"^\s*Rules:", text, re.M) else 0.0
    s += 0.1 if re.search(r"^\s*Finding:", text, re.M) else 0.0
    s += 0.2 * max(0.0, min(1.0, (250 - len(text.split())) / 150))
    return round(s, 3)
