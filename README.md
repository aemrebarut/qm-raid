# QM Raid

An RTS-style agent board for [QM](https://github.com/yc-software/qm) swarms, with [GBrain](https://github.com/garrytan/gbrain) as the shared memory the agents consult and grow.

Issues appear as targets on a 2.5D isometric map, agents are units you select, group and order like an RTS, and GBrain is the Library building: agents raise their staffs to recall from it and send learnings back into it. The Forge is a River building: describe a new kind of agent, it generates synthetic training data, fine-tunes a model with River, and you train units of that new type from it. Autopilot proposes orders with a short veto window.

## Screenshots

Captured on the test board (mock engine with synthetic replies) with the full art on. The demo board runs the same interface against real QM agents.

![Overview of the board](docs/screenshots/01-overview.jpg)

**The map**
- Each product component is a walled district. Open issues are monster camps sized by severity; Issue (N) spawns a new one.
- Units are QM agents on Codex models (knights, rangers, scouts, plus types forged with River). Click or drag to select, Ctrl+1..9 for control groups, right-click a camp to send them.
- GBrain use is visible: a blue beam from the Library when an agent recalls, a gold orb back into it when it remembers.
- Autopilot proposes orders; each waits 15 seconds for Cancel, Adjust or Go before it runs.

![Formation presets for a team](docs/screenshots/02-formation.jpg)

**Teams and formations**
- Select two or more units and press Formation (F) to make them a team.
- Pick one of eight workflow presets: Solo, Pair, Trio, Fan-out, Recon, Test first, Herald, Duel. Each card shows its graph.
- Assign roles by clicking a slot and then a unit, or by dragging a portrait; role badges float over the units on the map.

![A team workflow run in progress](docs/screenshots/03-workflow-run.jpg)

**A workflow run**
- Right-click a camp with the team selected: planner, implementer and reviewer take turns on the issue, each as its own QM agent.
- The reviewer ends with VERDICT: APPROVED or VERDICT: CHANGES. Changes loop back to the implementer until the loop limit, then the run asks for you.
- Run cards show the node chain, the active role and the loop count.

![The Forge with trained vs base scores](docs/screenshots/04-forge.jpg)

**The Forge (River)**
- Describe a new kind of agent. The Forge generates synthetic training data, fine-tunes Qwen/Qwen3.5-9B with LoRA on River, and evaluates it against the base model on held-out cases.
- Each type shows its stage, per-metric trained vs base bars and training stats. Refund Ranger scores 0.82 against 0.42 for the base; Rule Warden 0.917 against 0.557 on 32 held-out review cases.
- Train sends a unit of the new type out of the Forge, and it takes orders like any other unit.

![The Library knowledge graph](docs/screenshots/05-library.jpg)

**The Library (GBrain)**
- The graph of GBrain pages and links: components, rules, issues, customers, and the learnings the agents wrote back.
- Recent shows who recalled or remembered what; the index lists components, rules and issues. Search, or click any node to read its page.

![A unit's Loadout](docs/screenshots/06-loadout.jpg)

**Loadout**
- Standing orders are restated at the top of every order the unit gets, and saved with the unit.
- Toggle allowlisted QM skills and pick the model and effort. GBrain is always on.

## How it works

- **Units are real QM agents.** Each unit is one persistent QM conversation you can open in QM's own web UI. Classes map to Codex models: knight = gpt-6-astra (high effort), ranger = gpt-6-sol (medium), scout = gpt-6-luna (low). Forged units run on the model River trained for them.
- **An order** (right-click a camp) walks the unit over, then the bridge sends QM the issue, its component and the unit's standing orders. The agent recalls what the team knows from GBrain through MCP, does the work, and remembers its learning back into GBrain. Every step streams to the board over SSE: the recall beam, the reply, the remember orb.
- **Teams** run workflow graphs: planner, implementer and reviewer loops, fan-out, recon, test first, herald, duel. Reviewers and judges end with `VERDICT: APPROVED` or `VERDICT: CHANGES: <what>`, which drives the handoffs, with a loop limit that hands the run back to you.
- **Autopilot** looks at open issues, unit history and recent memory, and proposes orders. Each proposal waits 15 seconds for Cancel, Adjust or Go.
- **The Forge** runs a River pipeline: a teacher model (Qwen3.5-122B) writes synthetic training orders for the described job, River fine-tunes Qwen3.5-9B with LoRA, and the result is evaluated against the base model on held-out orders (about 4 minutes end to end). Ready types can be trained into units.
- **No QM core changes.** `qm-ext/install.ts` installs the GBrain MCP server and a raid-board skill pack into a stock QM through its own APIs.

## Architecture

Every component is its own service with one owner, talking HTTP only. The contract lives in `docs/CONTRACT.md` and `contract/types.ts`.

| Service | Dir | Port | Role |
|---|---|---|---|
| engine | `services/engine` | 4610 | game state, orders, teams, workflows, SSE |
| board | `apps/board` | 4611 | Three.js isometric client, talks only to the engine |
| forge | `services/forge` | 4612 | River training pipeline and forged units |
| autopilot | `services/autopilot` | 4613 | order proposals |
| qm-bridge | `services/qm-bridge` | 4614 | one QM conversation per unit |
| mock-bridge | `services/mock-bridge` | 4615 | scripted fake agents for tests |
| brain | `services/brain` | 4616, MCP on 4617 | the game's GBrain (the Library) |
| art | `packages/art` | 4620 | original low-poly assets and showroom |

## Run it locally

Needs [Bun](https://bun.sh) and the [gbrain](https://github.com/garrytan/gbrain) CLI. Each service README has its run command and environment variables. Run `bun install` in each directory first; the brain's GBrain setup is in `services/brain/README.md`. The quickest path uses the mock agents (no QM needed):

```sh
(cd services/brain && bun run dev)          # 4616, MCP 4617
(cd services/mock-bridge && bun run dev)    # 4615
(cd services/autopilot && bun run dev)      # 4613
(cd services/engine && BRIDGE_URL=http://127.0.0.1:4615 bun run dev)   # 4610
(cd apps/board && bun run dev)              # http://127.0.0.1:4611
world/reset.sh                              # seed the world
```

For real agents: run QM locally with Codex, then `QM_PORTAL_URL=http://localhost:8129 bun qm-ext/install.ts`, start `services/qm-bridge` and point the engine's `BRIDGE_URL` at 4614. The Forge needs a River API key in `services/forge/.env` (never committed).

## Sponsor tools

- **QM**: every unit is a real QM agent in its own conversation; the raid-board skill pack and the GBrain MCP server are installed from outside QM.
- **GBrain**: the Library is the game's shared memory (components, house rules, issues, customers and the learnings agents write back, all linked). The building agents also kept a separate development GBrain mapping this codebase as they worked.
- **River AI**: the Forge. Two unit types were trained today. Refund Ranger: our first attempt scored below the base model (0.66 vs 0.73), so we fixed the data; the second scores 0.82 vs 0.42 on held-out orders. Rule Warden (reviewer and judge): 0.917 vs 0.557 on 32 held-out review orders, verdict accuracy 0.97 vs 0.59; most of the base model's misses were missing verdict lines rather than wrong calls. Pipeline and eval notes: `river/PIPELINE.md`.

## Known limits

- QM has one global MCP registry, so plugins cannot be switched per unit; Loadout plugin choices are standing-order preferences, and GBrain is always on.
- Loadout skills come from an allowlist; QM skills that publish, send or touch credentials are never offered.
- Making standing orders a unit's real QM system prompt (one QM project scope per unit) works in tests but is not enabled in the demo.
- Screenshots come from the test board with synthetic replies; the demo runs the same interface against real QM agents. All data is synthetic.

## How it was built

Built during the Own Your Intelligence Hackathon (YC, San Francisco, 2026-09-27) by one human directing 31 AI agents: Claude Opus 5.5 planners and implementers with gpt-6-astra reviewers, in parallel lanes (engine, board, QM, GBrain, River, art, look, workflows, video). Contract first, everyone on `main`, no branches: about 490 commits in one afternoon. Plans are in `docs/`, test evidence in `docs/TEST.md`, reviews in `reviews/`.
