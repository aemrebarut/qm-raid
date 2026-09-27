# Team QM: the QM connection (critical path)
Agents: raid-qm-plan (lead), raid-qm-impl (implementer), raid-qm-rev (reviewer).
Owns: `services/qm-bridge/`, `qm-ext/`, `docs/lanes/qm-plan.md`, `reviews/qm.md`, and the local QM clone `qm/` (gitignored; run as shipped, never change QM core source).

Goal: real QM agents behind the Bridge API (docs/CONTRACT.md), with GBrain available to them as tools, so the board drives real QM workers.
- Implementer first step (now): `git clone https://github.com/yc-software/qm qm`, then bring up its local dev instance following `qm/.codex/skills/dev-instance/SKILL.md` and its docs (Docker is running). As soon as you know which env vars need a real model API key, tell the Analyst the exact variable names and file: `herdr agent prompt analyst "Q raid-qm: Emre needs to set ..."`. Never read or print keys.
- Planner first step (now): read qm/README, docs/swarms.md, docs/memory-providers.md and the API routes (clone read-only if the implementer has not yet; coordinate), then write the plan: the exact HTTP calls for session create, send, read (after, waitMs), swarm spawn/context/send, how tool calls and replies show up in reads, and how QM agents get MCP tools (GBrain MCP from raid-gbrain, which runs `gbrain serve`; agree transport and address with raid-gbrain; containers can reach host services via host.docker.internal).
- M1: `services/qm-bridge/test/smoke.ts` creates a QM session, sends "Say hello in five words", prints the reply. Record base URL, auth and working calls in docs/TEST.md.
- M2: qm-bridge on 127.0.0.1:4614 implements the Bridge API against real QM (swarm preferred; one session per unit fallback, say which). Activity (tool calls especially, named like `gbrain.recall`) and replies stream on GET /events. QM agents can call GBrain tools.
- M3: teams via swarm context `group`; per-unit model if QM allows (report); sessionUrl for "Open in QM".
- M4: a QM extension in `qm-ext/` (plugin, skill or connector, installed without core changes) that lets a QM user open the board and gives agents what they need.
