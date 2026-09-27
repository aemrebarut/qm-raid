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

ORDER_TEMPLATES = [
    "Work issue {issue} ({kind}, severity {severity}) in {component}: {title}. Reported by {customers}. Recall what GBrain knows first, then fix or triage it, and remember what you learned.",
    "New order: {issue} \"{title}\" in the {component} component. Customers affected: {customers}. Investigate and report back.",
    "{customers} report: {title}. This is {issue}, a severity {severity} {kind} in {component}. Handle it.",
    "Take {issue}. {title}. Component: {component}. What is your plan and what do you tell the customer?",
    "Triage {issue} ({component}, sev {severity}): {title}",
]


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


def _customers(t: dict, world: dict) -> str:
    names = {c.get("id"): c.get("name") for c in world.get("customers", [])}
    out = [names.get(c) or c.split("/")[-1].replace("-", " ").title() for c in t.get("customers", [])]
    return ", ".join(out) or "an internal team"


def _words(text: str) -> set[str]:
    return set(re.findall(r"[a-z]+", text.lower()))


def build_prompts(spec: TypeSpec, world: dict, n: int, seed: int) -> list[dict]:
    """Orders on Lumen issues, biased toward the issues matching the type's job."""
    rng = random.Random(seed)
    comps = {c["id"]: c.get("name", c["id"]) for c in world["components"]}
    job = _words(spec.description + " " + spec.name)
    targets = world["targets"]

    def weight(t: dict) -> float:
        w = 1.0 + 3.0 * len(job & _words(t["title"] + " " + t["component"] + " " + t["kind"]))
        return w

    weights = [weight(t) for t in targets]
    prompts = []
    for i in range(n):
        t = rng.choices(targets, weights=weights)[0]
        tpl = ORDER_TEMPLATES[i % len(ORDER_TEMPLATES)]
        order = tpl.format(issue=t["issue"], kind=t["kind"], severity=t["severity"],
                           component=comps.get(t["component"], t["component"]), title=t["title"],
                           customers=_customers(t, world))
        prompts.append({"order": order, "meta": {"targetId": t["id"], "issue": t["issue"], "component": t["component"]}})
    return prompts


def system_prompt(spec: TypeSpec) -> str:
    return (f"You are a {spec.name}, a unit on the Lumen agent board. Your job: {spec.description} "
            "Before acting, recall what the team brain knows about the component and customer. "
            "Answer with a short plan, the fix or triage decision, a reply to the customer, and one learning to remember.")


def template_response(spec: TypeSpec, p: dict, world: dict) -> str:
    """Deterministic stand-in for the teacher: structured, in the type's voice."""
    m = p["meta"]
    t = next(x for x in world["targets"] if x["id"] == m["targetId"])
    cust = _customers(t, world)
    first = cust.split(",")[0]
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

    def respond(self, spec: TypeSpec, p: dict) -> str:
        res = self.client.chat_complete(
            [{"role": "system", "content": system_prompt(spec)}, {"role": "user", "content": p["order"]}],
            base_model=self.model, max_tokens=400, temperature=0.7,
        )
        body = json.loads(res.response_json)
        return body["choices"][0]["message"]["content"].strip()
