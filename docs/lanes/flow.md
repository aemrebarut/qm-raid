# Feature: team workflows (agent graphs), owned across teams
Spec: docs/CONTRACT.md "Team workflows" and contract/types.ts (Workflow, WorkflowRun, workflow.* events).
- Engine: raid-eng-flow (new implementer) owns `services/engine/src/workflow.ts` (graph runner: presets to graphs, run state, edge selection from VERDICT lines, joins, loops, cancel, events); raid-eng-impl wires it into order dispatch, bridge reply handling and the routes; raid-eng-mock adds reviewer verdicts to mock-bridge. Lead raid-eng-plan sequences it; reviewer raid-eng-rev checks it on the 4618 test engine.
- Board: raid-ui-hud builds the Formation panel in the team view (preset picker, role slots with member dropdowns, a small node-link diagram of the graph, live run progress per node) and shows runs in the orders bar; raid-ui-scene adds role badges above units in a workflow team, a faint link line between the team's units during a run, and the handoff scroll animation (ask raid-art-fx for the scroll effect).
- Milestones: W1 16:00 trio runs end to end on the 4618 test engine with the mock (including one changes loop) and the panel can set a preset; W2 16:20 a trio run on real QM through 4611 with the handoff animation.

# Feature: spawn new issues (Emre, 15:35)
Spec: docs/CONTRACT.md `POST /api/targets`, brain `POST /issues`, event `target.spawned`.
- raid-gbrain: brain `POST /issues` plus a pool of about 15 extra synthetic Lumen issues (spread over components, each touching a house rule or a customer), reset with /reset.
- raid-eng-impl: engine `POST /api/targets` (free tile in the zone, then brain `POST /issues` with pos; the brain allocates the LUM and target ids; emit target.spawned with the returned Target; if the brain is down answer 503 and create nothing).
- raid-ui-plan: `apps/board/src/hud/newIssue.ts` (new file you own): a compact spawn dialog opened by hotkey N and by a top-bar button: Random (one click) or a short form (title, component, kind, severity). raid-look-hud adds the top-bar button hook and styles it; raid-ui-scene plays a spawn effect (ground crack or portal, the camp rises) on target.spawned.
- Due 16:05, tested on 4619 against 4618.

# Feature: unit loadout in the game (Emre, 15:40): system prompt, instructions, skills, plugins
Spec: docs/CONTRACT.md "Loadout", contract/types.ts Loadout and CatalogItem. Due 16:15, tested on 4619/4618 first, then one real unit on 4611.
- raid-qm-plan + raid-qm-impl: qm-bridge `GET /catalog` (QM skills from the qm-ext skill pack and QM's skill list, MCP servers or connectors QM knows, GBrain included) and `PATCH /units/:id` with loadout, model, effort. Find out first what QM can change per session without core changes (skills, MCP servers, prompt); report to the Analyst in one message, then implement the best path (per-session config, or respawn in the same stable conversation with a marker turn).
- raid-eng-mock: engine `GET /api/catalog` proxy and `PATCH /api/units/:id` loadout forwarding in `services/engine/src/loadout.ts` (new file you own; raid-eng-impl wires it); mock-bridge `GET /catalog` (a fixed plausible list) and loadout PATCH.
- raid-river: Forge units accept the loadout PATCH (instructions become the agent loop's system prompt).
- raid-ui-plan: `apps/board/src/hud/loadout.ts` (new file you own): a Loadout view for the selected unit: instructions text area with a few preset standing orders, skill and plugin toggles from /api/catalog with name and one-line description, model and effort pickers, Apply (with a clear applying and applied state). raid-look-hud mounts it as a tab in the side panel (one hook) and styles it; raid-look-dir includes it in the shots.
