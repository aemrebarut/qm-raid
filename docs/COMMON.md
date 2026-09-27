# QM Raid: common rules for every lane (read first)

Hackathon build, Sunday 2026-09-27. Orchestrator: the Analyst (herdr agent name `analyst`). Build window 14:35 to 16:40; projects due 17:00.

## The product
An RTS "agent board" for QM swarms, in a 2.5D isometric view (Three.js). QM's own swarm doc says "The agent-board UI is intentionally deferred"; we build it. Issues of a product appear as targets on an isometric map whose zones are the product's components. Agents are units: click a unit, click a target, and a real QM agent works the issue. Units can be grouped into teams (RTS control groups). An autopilot proposes orders with a 15 second veto window. GBrain is a building (the Library): agents walk to it and raise a staff to recall (blue beam) and send a gold orb to remember. Clicking the Library shows the knowledge graph. Stretch: a small River-trained "commander" model learns from the user's vetoes and becomes a new unit class.

## Hackathon rules that bind the design (final rules, 14:40)
- "Build something using GBrain" and the agents themselves must use GBrain: QM agents get GBrain as a tool (GBrain MCP, through QM's MCP or memory-provider path) so recall and remember are the agents' own tool calls. The engine turns those tool calls into animations. Orchestrator-side recall is only a fallback.
- "No prebuilt projects / forks of existing projects": we do NOT fork QM. We run QM as it ships and extend it through its APIs, plugins, skills and connectors. All our code lives in this new repo. Do not modify QM core source; configuration and extension files are fine.
- "Must build during hackathon hours": everything here is written today.

## Rules
- Microservices: every component is its own service or package in its own folder (docs/CONTRACT.md, table "Microservices"). Services talk only over HTTP; no service imports another's code; shared types only in `contract/types.ts` (Analyst-owned). Own only your folders. Never edit another agent's files; ask its owner (herdr prompt) or the Analyst.
- Git: one public repo (github.com/aemrebarut/qm-raid), everyone works on `main` in this one working tree. No branches, no worktrees, no rebase, amend, reset, stash, checkout of others' paths, or force push. Commit small and often (after every working step, at least every 10 minutes), only your own paths: `git add -- <your paths> && git commit -m "<agent-name>: <what>" -- <your paths> && git push origin main`. If git reports index.lock, wait 2 seconds and retry. The repo is public: never commit keys, .env files, transcripts or real data (a pre-commit hook scans for keys).
- Codebase map in GBrain (required): the build agents share a dev brain for the structure of this codebase, separate from the game brain. Use `scripts/devbrain <gbrain args>` (it serializes access). Before using another service, read its page: `scripts/devbrain get code/<service>` or `scripts/devbrain search "<term>"`. Keep one page per component you own current, at least at every milestone: `scripts/devbrain put code/<service> --force < page.md` (`--force` is needed to overwrite an existing page) with frontmatter `title` and `type: concept`, and sections Purpose, Run (command, port), Files (each file, one line), API, Depends on (wikilinks like [[code/engine]]), Gotchas. Record notable design decisions as `code/decisions/<slug>` pages linked to the component. After writing, run `scripts/devbrain extract links --source db`.
- Follow docs/CONTRACT.md exactly. If the contract is wrong or missing something, ping the Analyst with the proposed change; do not fork the contract silently.
- Something runnable at every milestone (docs/PLAN.md). Working and ugly beats pretty and broken. When a milestone is done, add your test line to docs/TEST.md (append only, one short section per milestone) and ping: `herdr agent prompt analyst "M<n> <lane> ready: <one line on how to test>"`.
- Blocked or unsure: `herdr agent prompt analyst "Q <lane>: <question>"` and keep going on what you can.
- Bind servers to 127.0.0.1 only, never 0.0.0.0. Ports 4610 to 4617 per the contract table; QM uses whatever its dev setup uses (report it). Never use 8787.
- Secrets: never read, print or copy API keys, tokens or credential files. If a key is needed, name the env var and ask the Analyst; Emre sets it himself.
- Push only to origin main of this repo. Do not publish anything else, open PRs, or create accounts. `qm/` (the QM clone) is gitignored and never modified in core source.
- Stop only processes you started, by exact PID. Never kill by pattern.
- Synthetic data only. No real people or companies.
- No em dashes or en dashes in code, docs or messages.
- Keep dependencies small and mainstream. Bun 1.4.2 and Node 26 are installed; Docker is running.

## Teams and roles
Agents (herdr names): QM team raid-qm-plan (lead), raid-qm-impl, raid-qm-rev. Engine team raid-eng-plan (lead), raid-eng-impl, raid-eng-mock, raid-eng-rev. UI team raid-ui-plan (lead), raid-ui-scene, raid-ui-hud, raid-ui-rev. Solo leads raid-gbrain and raid-river (the Forge, River building), reviewed by raid-rev.
- Planner (lead): within 8 minutes, write `docs/lanes/<team>-plan.md` (numbered small steps per implementer, each with an acceptance check, grouped by milestone) and commit any team scaffolding the implementers share. Then steer: answer implementer questions, adjust the plan, run the milestone test, append docs/TEST.md, keep the team's devbrain pages curated, and ping the Analyst at each milestone. Talk to teammates with `herdr agent prompt <name> "..."`.
- Implementer: start at once on the first step in your lane file, then follow the plan. Commit and push after every working step, then tell your reviewer: `herdr agent prompt <reviewer> "review <sha>: <one line>"`. Questions go to your lead; keys and cross-team contract questions go to the Analyst.
- Reviewer: review each commit you are told about (`git show <sha>`), run the service's smoke test, and send the implementer only concrete, actionable findings (bugs, contract mismatches, crashes, secrets), most severe first; copy the lead on blockers. Log each review in `reviews/<team>.md` (you own it). Do not edit code.
