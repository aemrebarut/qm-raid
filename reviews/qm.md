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
