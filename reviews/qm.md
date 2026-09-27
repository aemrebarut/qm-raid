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

## 2026-09-27 14:59 PDT: 9b6be9b MCP registration

- Reviewed the registration script against QM's admin route and authorizeAdmin implementation. The route accepts the live agent capability and still requires the actor's admin grant. The script stores no capability or signing secret.
- Executed `cd services/qm-bridge && bun scripts/register-gbrain-mcp.ts`: exit 0, run done/ok, HTTP 200, registered server gbrain with auth none and tools recall, remember, search, get_page, add_link.
- All game-memory access uses services/brain's existing MCP facade on 127.0.0.1:4617/mcp. No independent GBrain DB process was started. No blocking finding for the supported local configuration.

## 2026-09-27 14:59 PDT: 5ac1a89 Bridge API and lifecycle findings

- Read the full commit. `GET /health` passed; `bun test test/qm.test.ts` passed 2 tests; `bun test/bridge-smoke.ts` exited 0 in 4.8 s with a nonempty sessionId, order-correlated activity/reply, and successful DELETE.
- Built an isolated HTTP/fetch fixture from the exact committed server/client/tools files in /tmp. It captures Bun.serve in process, opens no listening port, and never touches the implementer's live server.
- **P2, server.ts:269-276: failed spawn remains registered and returns HTTP 200.** After principal discovery, simulate QM becoming unavailable. POST /units returns sessionId:null/sessionUrl:null instead of an error, and the unit remains in the map. Retrying the same spawn after recovery returns the same null response without starting another QM turn. Await the initial start result, return a dependency error on failure, and remove the failed reservation so retry can work.
- **P2, server.ts:323-328 and 154-178: deleted units continue emitting activity.** DELETE clears active but leaves follow's current reader alive; feed a TOOL_CALL_START after DELETE and the bridge emits a gbrain.remember event for that deleted unit. Abort the stream and guard emissions against a deleted/replaced unit. This prevents stale activity from entering a reset world.
- **P2, server.ts:253: delete and respawn reuses the old session.** The thread namespace uses unitId and process BOOT only. In the fixture, DELETE followed by POST /units with the same id returned the identical session and threadRef. Add a unique spawn incarnation so reset units do not inherit old conversation context.
- Forwarding QM's wrapped MCP args at server.ts:178 also hides slug/componentId/targetId from the engine; this is addressed by a25e220 below.
- Sent all three lifecycle findings to the implementer and copied the lead. They remain open at this checkpoint.

## 2026-09-27 14:59 PDT: a25e220 flat MCP arguments and unit header

- Reviewed the full diff. `bun test test/qm.test.ts`: 3 passed, 0 failed. The MCP argument test covers actual QM wrapper shape and the normalized tool name. The fix resolves the flat-argument integration finding.
- Ran an independent live HTTP smoke with a synthetic gpt-6-luna unit and two orders queued during its intro. First order made agent-originated gbrain.recall with flat componentId, targetId, and matching unitId; second order completed after the first. Each order emitted one reply with its own orderId, with no additional terminal during a one-second observation window. Total 11.1 s; DELETE succeeded.
- The first reply applied the billing idempotency rule from the game brain. No memory write was requested by this verification. Intro produced activity without an order terminal.
- Registration and the live recall/queue path are accepted. The three lifecycle findings above remain open; no live engine/board integration or remember persistence verdict is implied by this test.

## 2026-09-27 15:01 PDT: b6f8f1c and 96a7997 QM extension

- Reviewed both commits, README, skill content, and installer against QM's skill-pack routes. The corrected directory glob matches QM ingestion; existing packs are PATCHed before import. No QM core imports or credential files are introduced.
- Executed `QM_PORTAL_URL=http://localhost:8129 RAID_REF=b6f8f1c9a3e9c40fa6d205743131cec7e49a4665 bun qm-ext/install.ts --skip-mcp`: exit 0, eligible 1, imported/updated empty on an unchanged rerun. The existing pack id was reused; the portal lists one matching repo pack, pinned to b6f8f1c.
- A fresh synthetic documentation turn using gpt-6-luna completed done/ok. Its own transcript contains tool_call skills with action read and name raid-board, and the reply includes the exact documented unit/order/target/component/team header template.
- Extension installation and skill availability accepted with no new finding. MCP registration was independently verified in the 9b6be9b review; this installer rerun intentionally exercised only the skill-pack path.

## 2026-09-27 15:03 PDT: 15e2dda unknown-unit adoption

- Reviewed the full diff. `bun test test/qm.test.ts`: 3 passed. `bun test/bridge-smoke.ts`: exit 0 in 5.7 s with the expected order-correlated reply and DELETE. Idempotent DELETE of an unknown unit returns 200 in the isolated fixture.
- **P2, server.ts:319-323: adoption drops configured unit metadata and bypasses existing recovery.** createUnit({id}) defaults model/effort to empty, name to id, role to worker, and team to null. The engine already handles send 404 by re-POSTing the complete SpawnRequest and retrying (services/engine/src/game.ts, dispatchOrder). Returning 200 for adoption skips that path, so restarted units silently use QM defaults and the board retains an old session link. Preserve the engine's full respawn path or restore complete metadata through an agreed protocol.
- **P2, server.ts:315-327: unsupported reads mutate the unit map.** The adoption block runs before method/route validation. In an exact-commit isolated fixture, GET /units/review-probe returned 404 but created a unit. A following valid POST /units with scout model, low effort, and team 3 returned 200/null; the subsequent QM turn omitted model/thinkingLevel/team because the default unit was reused. Only supported, valid mutating routes should create units.
- Independently reproduced unknown-send metadata loss with a synthetic request. Sent both findings to implementer and lead. This commit does not resolve the three prior lifecycle findings; restart recovery remains unaccepted.

## 2026-09-27 15:11 PDT: ab8ce96 persistence and lifecycle review

- Routine review policy: isolated fixtures and mock test engine 4618 only. Real QM is reserved for milestone proof; coordinate any live 4614 check with raid-eng-plan. No real QM requests were made in this review.
- Reviewed the full diff and ran 3 client tests successfully. Exact-commit isolated fixture verifies the three original lifecycle findings are resolved: outage spawn returns 502 and retries successfully after recovery; no tool activity emits after DELETE; same-id respawn gets a new session.
- **P1, server.ts finish and backlog: undelivered terminal is lost across restart.** finish persists active:null, then emits the terminal to an in-memory backlog when no SSE client is connected. Completing while the engine is disconnected, restarting the bridge, then connecting /events returns only the open comment. The saved unit has no active run to re-follow and no saved terminal. Persist a replayable terminal before clearing active work, so the engine can complete the order after reconnect.
- **P2, server.ts loadUnits/startup: restored queued work loses its selected model.** loadUnits pumps work before runtimeConfig populates codexModels. A saved gpt-6-luna/low scout queue forwards thinkingLevel:low but no model. Fetch the catalog before resuming queues, or otherwise preserve the accepted model choice.
- The adoption block from 15e2dda is still present in this commit. Its two findings remain open here; a later corrective commit is under review.
- Reproductions: /tmp/raid-qm-review-ab8ce96/lifecycle/src/check.ts; offline/src/check.ts complete then restart; queued/src/check.ts. These snapshots bind no port and touch only synthetic state under their own /tmp directory.
- Mock engine smoke on 4618 passed health/state/SSE/validation/activity checks but could not observe its o1 completion. Subsequent state contained only o6, consistent with a concurrent reset/reassignment. Reported this as test interference, not an engine defect; no real-engine check was substituted.

## 2026-09-27 15:11 PDT: 5e878d1 usage accounting

- Reviewed the full diff and used a synthetic org-spend source with a captured timer; no real QM polling or orders.
- **P2, server.ts usage loop: totals are not conserved.** Rounding each share independently emits zero tokens for a delta of one across three units. lastWork also includes retired unit ids for 15 seconds; a 30-token delta split across one deleted and two live units emitted 10 tokens to each, so the engine discards the deleted unit's share. Exclude retired ids and distribute integer remainders while preserving the total.
- **P2, server.ts async usage interval: overlapping polls can regress the baseline and double count.** From base 131, responses completing as 151, delayed 141, then 161 emitted 42 tokens instead of 30, including the rounding error. Serialize polls and prevent an older response from moving spendBase backwards.
- Fixture: /tmp/raid-qm-review-5e878d1/src/check.ts. Lead has queued single-flight polling, live-unit filtering, and remainder handling after reliability fixes; disable optional usage if its timebox expires.

## 2026-09-27 15:11 PDT: 2d6f45d retry and idempotency review

- Reviewed the full diff. Four client tests pass. An additional isolated check confirms a keyed POST retries a network failure with an identical body; an unkeyed POST receives no retry on 502.
- **P1, server.ts begin/pump: a queued send's idempotency key is not saved before dispatch.** finish saves active:null plus the remaining queue, then pump removes its next send and begin assigns a key, but the next save occurs only after startTurn returns. Crash after QM accepts the request but before its response is saved: disk still has the queued send without a key; restart generates a different key and executes the order again. Assign and persist the key and active transition before making the external request, including sends started from finish and loadUnits.
- Exact-commit fixture observed a dispatched request with a generated raid key while units.json still contained active:null and queued next-order without any key. Fixture: /tmp/raid-qm-review-2d6f45d/src/check.ts.
- The network retry behavior is accepted; the claim that post-crash re-sends never start a second run is not yet accepted.

## 2026-09-27 15:12 PDT: 21a68ed adoption rollback

- Reviewed the full diff. Four client tests pass. Exact-commit fixture proves unknown GET/send/PATCH return 404, DELETE returns 200, unit count remains zero, and no QM turn starts from these requests.
- A subsequent full SpawnRequest and send forwards gpt-6-luna, low thinkingLevel, and team 3, with a nonempty new sessionId. Both adoption findings from 15e2dda are resolved.
- Follow now exits after receiving a stream chunk for a deleted/replaced/finished send and avoids the subsequent run read. Combined with ab8ce96's emission guards, the old deleted-unit activity finding remains resolved.
- Fixture: /tmp/raid-qm-review-21a68ed/src/check.ts. No live QM check was run.

## 2026-09-27 15:12 PDT: 7b2724d usage attribution window

- Reviewed the attribution-window change from 15 to 90 seconds. It broadens which recent units share delayed org-wide spend; it does not make usage attributable to a specific run.
- No new finding from this small change. The open 5e878d1 usage findings still apply: deleted ids remain eligible, integer rounding does not preserve totals, and overlapping polls can regress the baseline. The longer window extends retired-unit eligibility until those fixes land.
- Implementer-reported real engine/GBrain evidence was not rerun because the shared QM instance is reserved for the demo. Prior isolated accounting fixtures remain the relevant review evidence.
