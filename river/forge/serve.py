"""Model server for forge units: one long-lived child of services/forge, JSON lines over stdio.

Request (one line on stdin):
  {"id", "typeId", "name", "description", "model", "baseModel", "order", "context", "targetId"}
Response (one line on stdout): {"id", "text"} or {"id", "error"}

model "dry-run:<id>" answers with the template generator (same voice as the training data);
a river:// checkpoint is sampled on River with the same renderer and system prompt used in training.
"""
from __future__ import annotations

import json
import os
import sys
import time

from forge import datagen, env

env.load()

_session_ctx = None
_session = None
_renderers: dict = {}
_world = {"at": 0.0, "data": None}


def log(msg: str) -> None:
    print(f"[serve] {msg}", file=sys.stderr, flush=True)


def world() -> dict:
    if _world["data"] is None or time.time() - _world["at"] > 60:
        _world["data"] = datagen.load_world(os.environ.get("BRAIN_URL", "http://127.0.0.1:4616"))
        _world["at"] = time.time()
    return _world["data"]


def messages(req: dict) -> list[dict]:
    spec = datagen.TypeSpec(req["typeId"], req["name"], req["description"])
    msgs = [{"role": "system", "content": datagen.system_prompt(spec)},
            {"role": "user", "content": datagen.user_message(req["order"], req.get("context") or "")}]
    if req.get("followup"):  # a second turn on the same order, e.g. the reviewer verdict line
        msgs += [{"role": "assistant", "content": req.get("previous", "")}, {"role": "user", "content": req["followup"]}]
    return msgs


def dry_answer(req: dict) -> str:
    spec = datagen.TypeSpec(req["typeId"], req["name"], req["description"])
    w = world()
    if req.get("followup"):
        return "VERDICT: APPROVED"
    t = next((x for x in w["targets"] if x["id"] == req.get("targetId")), None)
    if t is None:
        return f"{spec.name}: understood. Give me an issue to work and I will recall, fix and report back."
    p = {"order": req["order"], "meta": {"targetId": t["id"], "issue": t["issue"], "component": t["component"]}}
    return datagen.template_response(spec, p, w)


def river_answer(req: dict) -> str:
    global _session_ctx, _session
    import river_client as river
    from river_client.renderers import get_renderer
    base = req["baseModel"]
    if base not in _renderers:
        _renderers[base] = get_renderer(base, thinking=False)
    r = _renderers[base]
    if _session is None:
        _session_ctx = river.Client(api_key=os.environ["RIVER_API_KEY"]).session(project="qm-raid-forge-units")
        _session = _session_ctx.__enter__()
    prompt = r.build_sample_prompt(messages(req)).prompt
    try:
        out = _session.sample(prompt, base_model=base, checkpoint=req["model"], max_tokens=450,
                              temperature=0.3, stop=r.get_stop_strings())
    except Exception:
        _session_ctx, _session = None, None  # reopen on the next request
        raise
    return out[0][0].text.strip()


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            text = dry_answer(req) if str(req.get("model", "")).startswith("dry-run:") else river_answer(req)
            print(json.dumps({"id": rid, "text": text}), flush=True)
        except Exception as e:
            log(f"request {rid} failed: {type(e).__name__}: {e}")
            print(json.dumps({"id": rid, "error": f"{type(e).__name__}: {str(e)[:200]}"}), flush=True)


if __name__ == "__main__":
    main()
