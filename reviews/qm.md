# QM review log

Owner: raid-qm-rev. Implementation owners: raid-qm-plan and raid-qm-impl.

## 2026-09-27 14:46 PDT: initial review readiness

- Read docs/COMMON.md, docs/PLAN.md, docs/CONTRACT.md, contract/types.ts, and docs/lanes/qm.md at baseline 9f0705c.
- No qm-bridge implementation or smoke test exists at this checkpoint. No code verdict yet.
- Requested commit SHAs and safe runtime test details from the QM lead and implementer.
- M1 acceptance: the shipped QM instance creates a synthetic session, accepts "Say hello in five words", and returns a completed model reply through services/qm-bridge/test/smoke.ts. Report credential variable names and configuration paths only.
- M2 review focus: exact Bridge API response and SSE shapes; final reply versus partial activity; cursor correctness; dependency failure handling; agent-originated GBrain calls; loopback binding; no cross-service code imports or tracked credentials.
- Later review focus: swarm group updates, per-unit models, working session URLs, extension installation without QM core edits, and two consecutive demo runs.
- Review records will identify each commit, checks executed, concrete findings, and unverified behavior. QM core remains read-only.

## 2026-09-27 14:48 PDT: contract v3 and upstream API checks

- Read contract change 75dc182 and the current shared types. The bridge must preserve each send's orderId on activity, reply, and terminal error events. Later completion of cancelled work must never be relabeled with a newer orderId.
- Confirmed ordinary session transcript reads accept sinceSeq, tailTurns, and beforeSeq in qm/plugins/web-ui/server/index.ts. Swarm message reads use after and waitMs. Reported this distinction to the lead and implementer.
- Confirmed human swarm initialization requires a runId for the same session and actor; context changes replace the caller's context, not another peer's. Reported to the lead for M3 planning.
- Confirmed registered MCP tools are named serverId_toolName and the MCP registry supports auth:none. Agent-originated tools require normalization into the Bridge API's gbrain-prefixed events. Reported to the lead.
- Contract v3 requires all game-brain access to go through services/brain. No reviewer command opens the game brain.
- Implementer reports dependencies installing and web dev-instance boot in progress. Safe planned smoke command: cd services/qm-bridge && bun run test/smoke.ts with QM_URL. Real-model credentials are ANTHROPIC_API_KEY for pi, or HARNESS=codex with CODEX_AUTH_FILE; values were neither requested nor read. Live M1 remains unverified.

## 2026-09-27 14:49 PDT: 769c1c3 plan and scaffold

- Scope: docs/lanes/qm-plan.md, services/qm-bridge/package.json, README.md, and .env.example. Read the commit and checked the proposed routes against QM source. No blocking scaffold defect found.
- Executed `cd services/qm-bridge && bun run smoke`: exit 1, `Module not found "test/smoke.ts"`. This commit contains a scaffold only; M1 runtime acceptance remains pending implementation and a real-model reply.
- Checked signing recipe against qm/src/auth/source-auth-sign.ts and signed-token.ts, swarm constraints against routes/swarms.ts, and run streaming against routes/run-events.ts.
- Sent source-derived implementation checks to both teammates: CUSTOM name=run has the run directly in value, initial/reconnect text is in run.partial, and RUN_FINISHED also terminates failed runs. Completion must use run.status and run.result instead of treating the event name alone as success.
- Clarified to the lead that a mock hello proves wiring only, not real-model M1. The lead's plan selects the Codex harness with existing local OAuth.
- Devbrain code/qm-bridge was not yet published when checked; code/qm-review remains the reviewer-owned map page.

## 2026-09-27 14:51 PDT: 4e099bb portal client and M1 smoke

- Reviewed all four changed files and read the current code/qm-bridge page. No credentials or QM core imports are introduced. The client uses the local portal's existing authentication relay.
- Runtime prerequisite: `cd qm && bash scripts/dev-instance.sh status` reported pool1 live on ports 8081/8097/8113/8129.
- Executed `cd services/qm-bridge && bun test/smoke.ts`: exit 0 in 6.1 s, run status done, result status ok, nonempty sessionId, and a five-word model reply. M1's real-model path is independently verified on this instance.
- **P1, services/qm-bridge/src/qm.ts:78: waitRun treats pending as terminal.** QM's run-store status union is pending/running/done/failed and app-turn.ts returns that status unchanged. A newly queued or retried run can therefore make waitRun return result:null before execution and make the smoke fail spuriously. Return only for done/failed, or include pending in the nonterminal states.
- Reproduction: temporarily substituted fetch in an isolated Bun process with synthetic pending -> running -> done responses. waitRun returned pending after one read; expected done after three reads. No live service was replaced or stopped.
- Sent the finding and successful live smoke evidence to raid-qm-impl and raid-qm-plan in the default Herdr session. Queue-state fix and regression check remain open; Bridge API/MCP behavior is not part of this commit and remains unverified.

## 2026-09-27 14:52 PDT: b697d86 polling fix, M1 accepted

- The requested SHA 24bf23b is a concurrent UI commit. The actual QM polling fix is b697d86; reviewed that full diff and notified the implementer of the SHA correction.
- **Resolved P1 from 4e099bb.** runFinished now waits through pending/running and returns on done/failed or a result, matching QM's run-events terminal condition.
- Executed `cd services/qm-bridge && bun test test/qm.test.ts`: 2 passed, 0 failed. The tests cover pending -> running -> done with three fetches, and pending -> failed.
- Repeated `bun test/smoke.ts` after the fix: exit 0 in 3.1 s, done/ok, nonempty sessionId, and a five-word model reply. M1 is accepted with no remaining client findings.
- Read the updated Codex class map in docs/CONTRACT.md. The live portal advertises gpt-6-astra, gpt-6-sol, and gpt-6-luna under its sole approved harness, codex. This confirms model availability, not per-class execution or effort settings, which remain for M3.
- Bridge service routes, agent-originated GBrain tools, and queued Bridge orders remain future acceptance work.
