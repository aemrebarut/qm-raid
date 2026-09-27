"""Synthetic SFT data for a forged unit type.

Prompts are orders on Lumen issues (from the brain service GET /world), phrased
the way the engine phrases orders. Responses come from a River teacher model
when a key is set, else from a local template generator in the type's style.
All data is synthetic.
"""
from __future__ import annotations

import json
import os
import random
import re
import urllib.request
from dataclasses import dataclass

FALLBACK_WORLD = {
    "components": [
        {"id": "billing", "name": "Billing"}, {"id": "auth", "name": "Auth"},
        {"id": "onboarding", "name": "Onboarding"}, {"id": "search", "name": "Search"},
    ],
    "targets": [
        {"id": "t1", "issue": "LUM-12", "title": "Retry double-charges a card", "component": "billing", "kind": "bug", "severity": 3, "customers": ["acme-robotics"]},
        {"id": "t2", "issue": "LUM-14", "title": "Refund email shows the wrong currency", "component": "billing", "kind": "bug", "severity": 2, "customers": ["northwind-labs"]},
        {"id": "t3", "issue": "LUM-21", "title": "Magic link expires too early", "component": "auth", "kind": "bug", "severity": 2, "customers": ["blue-harbor"]},
        {"id": "t4", "issue": "LUM-22", "title": "SSO for workspace admins", "component": "auth", "kind": "feature", "severity": 1, "customers": ["acme-robotics"]},
        {"id": "t5", "issue": "LUM-31", "title": "Invite step loses the team name", "component": "onboarding", "kind": "bug", "severity": 2, "customers": ["kite-analytics"]},
        {"id": "t6", "issue": "LUM-41", "title": "Search ignores archived projects filter", "component": "search", "kind": "bug", "severity": 1, "customers": ["northwind-labs"]},
    ],
    "customers": [],
}

# Train and eval use disjoint phrasings, so no held-out prompt is ever seen in training.
TRAIN_TEMPLATES = [
    "Work issue {issue} ({kind}, severity {severity}) in {component}: {title}. Reported by {customers}. Recall what GBrain knows first, then fix or triage it, and remember what you learned.",
    "New order: {issue} \"{title}\" in the {component} component. Customers affected: {customers}. Investigate and report back.",
    "{customers} report: {title}. This is {issue}, a severity {severity} {kind} in {component}. Handle it.",
    "Take {issue}. {title}. Component: {component}. What is your plan and what do you tell the customer?",
    "Triage {issue} ({component}, sev {severity}): {title}",
    "Order from the board: go to {component} and deal with {issue}, \"{title}\". {customers} is waiting.",
    "{issue} needs an owner. {title} ({kind}, {component}). Customers: {customers}.",
    "Please look at {issue} in {component}. Summary: {title}. Severity {severity}.",
    "You are assigned {issue}: {title}. It affects {customers}. Recall, act, remember.",
    "Incoming {kind} in {component}: {title} ({issue}). Reporter: {customers}.",
]
EVAL_TEMPLATES = [
    "Heads up, {customers} just escalated {issue} ({component}): {title}. What do you do?",
    "Assignment: {issue}. Area {component}. Problem: {title}. Priority {severity} of 3.",
    "Can you own {issue} for {customers}? It is a {component} {kind}: {title}.",
]
EXTRAS = ["", " The customer is upset.", " It is blocking their month-end close.", " Keep the reply short.",
          " This is the second report this week.", " Support already asked twice."]


@dataclass
class TypeSpec:
    id: str
    name: str
    description: str


def load_world(brain_url: str) -> dict:
    try:
        with urllib.request.urlopen(f"{brain_url}/world", timeout=3) as r:
            world = json.load(r)
        if world.get("targets"):
            return world
    except Exception:
        pass
    return FALLBACK_WORLD


def load_contexts(brain_url: str, world: dict) -> dict:
    """Brain recall context per target (read-only POST /recall), so training prompts look like serve-time prompts."""
    out = {}
    for t in world["targets"]:
        try:
            req = urllib.request.Request(f"{brain_url}/recall", method="POST", headers={"content-type": "application/json"},
                                         data=json.dumps({"componentId": t["component"], "targetId": t["id"], "unitId": "forge-datagen"}).encode())
            with urllib.request.urlopen(req, timeout=5) as r:
                ctx = json.load(r).get("context", "")
            out[t["id"]] = ctx if isinstance(ctx, str) else json.dumps(ctx)
        except Exception:
            out[t["id"]] = ""
    return out


def user_message(order: str, context: str) -> str:
    """The user turn for training, eval and serving (river/forge/serve.py uses this too)."""
    return order + ("\n\nWhat the team brain knows:\n" + context[:1500] if context else "")


def _customers(t: dict, world: dict) -> str:
    names = {c.get("id"): c.get("name") for c in world.get("customers", [])}
    out = [names.get(c) or c.split("/")[-1].replace("-", " ").title() for c in t.get("customers", [])]
    return ", ".join(out) or "an internal team"


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def _order(tpl: str, extra: str, t: dict, world: dict, comps: dict) -> dict:
    order = tpl.format(issue=t["issue"], kind=t["kind"], severity=t["severity"],
                       component=comps.get(t["component"], t["component"]), title=t["title"],
                       customers=_customers(t, world)) + extra
    return {"order": order, "meta": {"targetId": t["id"], "issue": t["issue"], "component": t["component"], "extra": extra.strip(),
                                        "customers": [c.strip() for c in _customers(t, world).split(",") if c.strip()]}}


def build_split(spec: TypeSpec, world: dict, n_train: int, n_eval: int, seed: int) -> tuple[list[dict], list[dict]]:
    """Unique train and eval orders on Lumen issues, weighted toward issues matching the type's job.

    Train uses TRAIN_TEMPLATES and eval uses EVAL_TEMPLATES, so there is no prompt overlap by construction
    (asserted anyway). Sampling is without replacement (weighted keys), so every prompt is unique.
    """
    rng = random.Random(seed)
    comps = {c["id"]: c.get("name", c["id"]) for c in world["components"]}
    job = _words(spec.description + " " + spec.name)

    def weight(t: dict) -> float:
        return 1.0 + 3.0 * len(job & _words(t["title"] + " " + t["component"] + " " + t["kind"]))

    def pick(templates: list[str], k: int) -> list[dict]:
        pool = [(t, tpl, ex) for t in world["targets"] for tpl in templates for ex in EXTRAS]
        keyed = sorted(pool, key=lambda c: rng.random() ** (1.0 / weight(c[0])), reverse=True)
        return [_order(tpl, ex, t, world, comps) for t, tpl, ex in keyed[:k]]

    train, evalset = pick(TRAIN_TEMPLATES, n_train), pick(EVAL_TEMPLATES, n_eval)
    overlap = {p["order"] for p in train} & {p["order"] for p in evalset}
    assert not overlap, f"train/eval prompt overlap: {len(overlap)}"
    assert len({p["order"] for p in train}) == len(train), "duplicate train prompts"
    return train, evalset


def system_prompt(spec: TypeSpec) -> str:
    return (f"You are a {spec.name}, a unit on the Lumen agent board. Your job: {spec.description} "
            "Before acting, recall what the team brain knows about the component and customer. "
            "Answer under these headings, in order: Recall:, Plan:, Decision:, Customer reply:, Remember:. "
            "Name the issue id, the component and the customer.")


def template_response(spec: TypeSpec, p: dict, world: dict) -> str:
    """Deterministic stand-in for the teacher: structured, in the type's voice."""
    m = p["meta"]
    t = next(x for x in world["targets"] if x["id"] == m["targetId"])
    first = (m.get("customers") or [_customers(t, world)])[0]
    verb = "fix" if t["kind"] == "bug" else "scope"
    return (
        f"{spec.name} on {t['issue']}.\n"
        f"Recall: checking components/{t['component']} and {', '.join('companies/' + c for c in t.get('customers', [])) or 'no customer pages'} for house rules and past learnings.\n"
        f"Plan: reproduce \"{t['title']}\", find the root cause in {t['component']}, {verb} it behind a test, and confirm with {first}.\n"
        f"Decision: severity {t['severity']} {t['kind']}; {'handle now' if t['severity'] >= 2 else 'queue for this week'}.\n"
        f"Customer reply: Hi {first}, thanks for flagging {t['issue']}. We have reproduced it and a fix is on the way; we will confirm once it ships.\n"
        f"Remember: {t['component']}: {t['title'].lower()} -> check this first on similar reports."
    )


class RiverTeacher:
    """Teacher responses from a large base model on River (chat_complete)."""

    def __init__(self, client, model: str):
        self.client, self.model = client, model

    @classmethod
    def from_env(cls, model: str) -> "RiverTeacher | None":
        key = os.environ.get("RIVER_API_KEY")
        if not key or not model:
            return None
        import river_client as river
        return cls(river.Client(api_key=key), model)

    def respond(self, spec: TypeSpec, user: str) -> str:
        res = self.client.chat_complete(
            [{"role": "system", "content": system_prompt(spec)}, {"role": "user", "content": user}],
            base_model=self.model, max_tokens=450, temperature=0.7,
            chat_template_kwargs={"enable_thinking": False}, timeout=120,
        )
        body = json.loads(res.response_json)
        return body["choices"][0]["message"]["content"].strip()
