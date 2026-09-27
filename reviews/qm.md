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

## 2026-09-27 15:14 PDT: 4d1ddc6 longer run recovery

- Reviewed the six-line retry-window diff. An isolated exact-commit fixture injected six consecutive stream HTTP 503 responses, then recovery. The bridge reconnected on attempt seven and emitted exactly one reply with the original orderId; the prior five-attempt limit would have failed this case.
- Virtual-time backoff advanced 20 seconds with the five-second cap. No real QM request, process restart, or live bridge access was needed. Change accepted; existing persistence/accounting findings remain open.
- Fixture: /tmp/raid-qm-review-4d1ddc6/src/check.ts.

## 2026-09-27 15:14 PDT: revised session continuity requirement

- The lead relayed Emre's new priority: one persistent QM conversation per unit, using threadRef web:emre:raid-<ns>-<unitId> with QM_THREAD_NS. Session continuity across respawn/reset/restart is intended. This supersedes the earlier fresh-session reset requirement and its associated review finding.
- Acceptance for the upcoming change: DELETE then POST of the same id retains sessionId, reset inserts a visible New round marker, later orders land in that same session, and http://localhost:8129/s/<sessionId> renders the chat.
- Verify isolated behavior first; coordinate any necessary real milestone check with raid-eng-plan before touching the shared QM bridge.

## 2026-09-27 15:26 PDT: b251ab1 session continuity and dispatch persistence

- Four client tests pass. Exact-commit isolated fixtures verify stable threadRef, no turn on live metadata refresh, persisted retired id, New round marker on DELETE/POST, same session for the following order, and /s/<sessionId> URL shape.
- **Resolved P1 from 2d6f45d.** The queued dispatch fixture holds the QM response open and reads .state: active.runId is empty, active.send.key equals the request idempotencyKey, and the queue transition is already persisted before QM responds.
- Coordinated the real milestone check with raid-eng-plan and raid-qm-impl. Used only qmrev-continuity-1790547873772, never engine u1..u10. Initial spawn, metadata refresh, and DELETE/POST all returned session cba4f6c7-bd61-42f3-b86c-63cffefa2eea. Refresh added no transcript entries. The transcript has the intro, New round marker, and following order. Exactly one correlated reply, "continuity verified.", arrived in 4.3 s. The review unit was deleted afterward, and the implementer was notified that the restart window was free.
- Browser rendering of the returned /s/ URL is still being checked; transcript/API acceptance is complete. Fixtures: /tmp/raid-qm-review-b251ab1/{continuity,idempotency}/src/check.ts. Live evidence: /tmp/raid-qm-review-continuity-live.json.

## 2026-09-27 15:26 PDT: 178bae6, b7a6529 and ece802f hardening

- **Resolved P1 from ab8ce96 at b7a6529.** Repeated the exact original completion-with-no-clients reproduction in two isolated processes. The saved state now contains the order-correlated undelivered reply; after restart, /events replays it and clears the persisted backlog. No real bridge restart was performed by the reviewer.
- 178bae6 correctly holds queued work until a delayed catalog response arrives and then forwards gpt-6-luna plus low effort. **P2 remains on the 15-second fallback:** with runtime-config still pending, resolving the boot timeout pumps the saved order with thinkingLevel:low but no model. This reproduces the same unintended default-model behavior during a slow/recovering QM startup. Keep selected-model orders queued until catalog readiness, or return an explicit dependency failure instead of silently using the default model.
- ece802f timing accepted: the isolated completed order writes one JSONL row with matching unit/order id, depth, and nondecreasing send/queued/first-event/terminal timestamps. 3324326 only changes stdout clock formatting to local time; epoch fields are unchanged.
- Fixtures: /tmp/raid-qm-review-178bae6/catalog/src/check.ts (default and timeout); /tmp/raid-qm-review-b7a6529/offline/src/check.ts (complete then restart); /tmp/raid-qm-review-ece802f/timing/src/check.ts.

## 2026-09-27 15:26 PDT: f8585e4 usage corrections

- Exact-commit synthetic spend checks pass integer conservation (one token across three units), deletion before a poll (30 tokens split only between two live units), single-flight polling, and ignoring a lower token counter before the next increase. The original overlapping-poll and per-share rounding findings are resolved.
- **P2 remains, server.ts usage interval around await orgSpend:** eligible ids are captured before the awaited HTTP request. Delete one of two units while that request is pending, then resolve a 10-token delta: it emits five tokens for the deleted id and five for the survivor. The engine discards the deleted share, losing half the total. Refilter live units after orgSpend resolves, before dividing and emitting; absorb the delta if no eligible units remain.
- Fixture: /tmp/raid-qm-review-f8585e4/src/check.ts. This check made no real QM requests.

## 2026-09-27 15:28 PDT: normal QM chat UI accepted

- Opened the live check's exact /s/cba4f6c7-bd61-42f3-b86c-63cffefa2eea URL in a separate Chrome tab. The normal QM web UI renders the titled conversation and lists it in Personal. Accessibility inspection and a screenshot show the intro, New round marker, order header, Gbrain Recall tool entry, and "continuity verified." reply in the same chat.
- b251ab1 continuity acceptance is complete, including UI rendering. No browser message was submitted and no engine unit was changed. The earlier Orca desktop driver could not focus the Chrome window; the available native CUA app driver completed this read-only check.

## 2026-09-27 15:31 PDT: 438d9c9 residual bridge P2s resolved

- Repeated the exact isolated catalog fixtures with delayed readiness and the 15-second fallback. Both now dispatch gpt-6-luna with low effort. This resolves the remaining selected-model loss finding for the contract's gpt-* class models. The warning for unsupported models is deduplicated by unit/model text; QM remains responsible for rejecting invalid forwarded models.
- Repeated usage fixtures for rounding, deleted-before-poll, single-flight, and a lower source counter. All pass. Deleting one of two eligible units during a pending spend request now assigns the whole 10-token delta to the survivor; deleting all eligible units emits no usage. This resolves the remaining deleted-share finding.
- Four client tests pass. No live bridge request or restart was made. Fixtures: /tmp/raid-qm-review-438d9c9/{catalog,usage}/src/check.ts.

## 2026-09-27 15:31 PDT: d4d1a26 demo dry-run script

- Reviewed the exact script and executed it only with fully substituted fetch and SSE fixtures. Implementer-reported real two-wave success was not rerun against shared QM.
- **P1, test/demo-dry.ts:103-107: cleanup trusts agent-provided slugs outside the test's ownership.** remembered is collected directly from gbrain.remember activity args and every value is sent to /forget. A fixture with a qmdry unit calling remember on learnings/lum-101-u1-1790000000000 caused the script to forget that non-test learning. Brain /forget accepts arbitrary learnings slugs, so a model using the wrong slug can make this dry run delete an engine learning. Limit cleanup to the exact unique slugs generated by this run, and flag out-of-scope remember calls instead of deleting their targets.
- **P2, test/demo-dry.ts:92-113: failure reports still exit 0.** A fixture where both waves emit terminal errors, no recall or remember occurs, and the wave-1 page returns 404 still finishes with exit 0. Missing wave-1 citation also only prints false. Enforce the intended acceptance conditions with nonzero exit status and place owned-unit cleanup in finally so failures do not leak test units.
- Fixture: /tmp/raid-qm-review-d4d1a26/check.ts failure and cleanup. It opens no port, makes no real HTTP request, and deletes no real page.

## 2026-09-27 15:32 PDT: 860550b observer streams accepted

- Exact-commit isolated fixture verifies an observer receives live activity, replies and pings without counting as terminal delivery. With only observers connected, the reply stays in persisted undelivered state; a second observer receives no replay and leaves that state intact. A normal engine client receives the backlog and clears it. With the engine connected, live replies reach all streams without creating a backlog.
- test/watch-orders.ts fixture verifies the request uses observe=1, handles an event split across chunks, reports recall/remember on success, flags missing tools and errors, and filters unrelated unit prefixes. demo-dry.ts now uses observe=1 too; its two prior test-script findings remain open.
- Future reviewer attachments to real 4614 use /events?observe=1. No live attachment was used for this review. Fixtures: /tmp/raid-qm-review-860550b/src/check.ts and watch-check.ts.

## 2026-09-27 15:35 PDT: a0ee5da dry-run fixes accepted

- Followed the planner's updated instruction to verify with fake HTTP only before the demo hold; no live run, brain writes, forget calls or service restart.
- **Resolved d4d1a26 P1:** a synthetic remember of a foreign engine learning now prints NOT forgotten and sends no /forget for it. A successful two-wave fixture forgets exactly its two generated slugs.
- **Resolved d4d1a26 P2:** terminal-error, foreign-slug-only, missing-page, and thrown-page-request fixtures all exit 1; the successful two-wave fixture exits 0. Every case attempts DELETE for both run-specific unit ids in finally. Citation is explicitly informational under the updated acceptance criteria.
- Updated watcher fixture passes remembered/cited slug reporting and the persisted send-relative timing fields. Repeated 860550b observer isolation fixture passes: observer-only terminals remain durable, late observers get no replay, and an engine client gets the backlog.
- Fixtures: /tmp/raid-qm-review-a0ee5da/test/check.ts (success, failure, foreign, missing-page, throw), test/watch-check.ts; /tmp/raid-qm-review-860550b/src/check.ts. No remaining findings from this review batch.

## 2026-09-27 15:38 PDT: Loadout plugin capability source review

- Split research with raid-qm-plan, who owns prompt/skills findings and the combined Analyst report. Reviewer inspected plugins only; no live configuration or credential access.
- No native per-session or per-turn MCP server selection found. Server enabled is global; the shared snapshot supplies every turn (qm/src/mcp/mcp-tool-service.ts:106,141; qm/src/tools/primitives.ts:1237). The readOnly turn option filters non-read-only MCP tools as a class, not a plugin allowlist (qm/src/harness/agent-tools.ts:4026).
- Connector admin settings can store scoped records, but runtime resolution reads only the org record then environment fallback (qm/src/api/routes/admin-resources.ts:899; qm/src/connectors/connector-client-store.ts:130). A per-project enabled flag therefore does not select plugins at runtime. OAuth credentials and revocation are principal-wide; per-user MCP credentialScope changes authentication, not per-unit visibility (qm/src/api/routes/connectors.ts:429,451; qm/src/mcp/mcp-tool-service.ts:85).
- Core MCP CRUD and scope-config routes accept source or agent auth with admin authorization. Scope-config has an admin UI relay; MCP has the already proven admin-agent capability path (qm/src/api/routes/admin.ts:89,107; qm/src/api/routes/admin/mcp-servers.ts:14; qm/plugins/admin/src/index.ts:452).
- Sent the requested five-line source report to raid-qm-plan; agent_prompted confirmed. Recommendation for the existing API: represent per-unit plugin choices as standing-order preferences unless an actual enforcement mechanism is added. A unit toggle must not mutate global MCP or principal connector state. Loadout implementation acceptance is pending.

## 2026-09-27 15:41 PDT: Plan B project-scope browser probe

- Opened the lead's exact /s/e272ed96-22d7-4b43-bab7-3c642eeb9df9 probe in the normal QM web UI. Accessibility and screenshot inspection show the project breadcrumb, successful scope SOUL write, and the second-turn reply beginning HALBERD. No message was submitted by the reviewer.
- Reported this browser probe PASS to raid-qm-plan and the Analyst, explicitly retaining full flagged bridge acceptance as pending. It proves project-scope chat rendering, not bridge Loadout behavior.
- Current acceptance adds LOADOUT_SOUL prefix gating: flag unset and nonmatching ids must create zero projects and write zero SOUL. The admin PUT/read-back implementation is now being reviewed with fake HTTP during the 15:46-15:57 live-call hold.

## 2026-09-27 15:55 PDT: Loadout A and flagged B server review

- Reviewed 3136dd3, c04d2a4, 565dd9a and c304792. Seven client/unit tests pass. Exact c304792 snapshots use fully replaced fetch and Bun.serve; no real HTTP requests, port binding, or runtime-state edits.
- Fresh units with LOADOUT_SOUL unset and with a nonmatching qmtest- prefix make zero project or SOUL calls, including after PATCH. Matching-prefix and all-unit modes create one project, forward scopeId on every turn, write/read back SOUL, and reuse the project on DELETE/POST. Relay failure queues the agent fallback.
- Plan A fixture confirms same-loadout PATCH is a no-op; a changed marker waits behind the active order and emits no terminal; following orders restate instructions/skills/plugins. Synthetic catalog filters drafts/disabled servers and caches the response. Group-scope silent runs return one correlated reply from the last web post.
- **P2, server.ts PATCH validation:** model, effort and team mutate before loadout validation. PATCH {team:9,model:gpt-6-sol,effort:high,loadout:null} returns 400, but the next order uses those new settings. Validate the whole request before mutation. Related POST malformed loadout leaks into createUnit and returns QM unavailable 502 from loadoutLines; reject it with 400 before creating anything.
- **P2, server.ts applyLoadout:** only new spawn checks soulFor. A restored unit with scopeId still issues a SOUL PUT with LOADOUT_SOUL unset. Gate SOUL writes and fallback for restored/nonmatching units too, consistent with the explicit zero-write acceptance.
- Both findings sent to raid-qm-impl and raid-qm-plan; both commands returned agent_prompted. Full B acceptance still awaits fixes and the coordinated post-rehearsal live probe. Fixture: /tmp/raid-qm-review-c304792/check.ts (default, prefix-other, prefix-match, all, fallback, bad-patch, bad-spawn, restored-off).

## 2026-09-27 16:00 PDT: Loadout fixes and reset revision accepted

- **Resolved both Loadout P2s at f7168c7.** Repeated the original invalid PATCH and malformed POST cases: 400 now leaves team/model/effort unchanged and creates no unit/project/turn. Restored units with LOADOUT_SOUL unset or prefix nonmatching make zero SOUL writes, drop queued agent-SOUL writes, and keep scopeId for ordinary turns as the lead decided. Fresh default and prefix-nonmatching units also retain zero project/SOUL calls.
- Nine repository tests pass, including the new ephemeral-port fake-portal bridge tests. Independent snapshots: /tmp/raid-qm-review-f7168c7/check.ts (default, prefix-other, prefix-match, bad-patch, bad-spawn, restored-off, restored-prefix). All test processes exit; no watcher or headless browser is running.
- c304792 failure checks accepted: mismatched admin read-back triggers fallback without claiming admin success; failed fallback emits error activity with no applied message; silent-without-web-post yields one order-correlated error terminal. Fixtures: /tmp/raid-qm-review-c304792/check.ts mismatch, fallback-bad, no-post.
- e80d307 accepted: normalization keeps GBrain present and catalog identifies it as The Library: always on. The lead confirms GBrain is the only registered MCP server and no connector is configured on this deployment. The absent admin MCP list relay is a documented catalog limitation, not an open finding; future additional servers need a supported inventory path.
- ed6ed2d accepted against the lead's revised reset behavior: DELETE/POST retains the session with no extra turn; the next order starts with the New round line. A held HTTP request proves that line moves to active.send and is persisted with the idempotency key before QM responds. This supersedes the separate round-marker-turn acceptance. Fixtures: /tmp/raid-qm-review-ed6ed2d/{continuity,dispatch}/src/check.ts.
- Awaiting the implementer's restart-ready notice for one qmtest-rev unit and one order, with observer stream and DELETE cleanup. Finish before 16:08 to avoid video slots. Full B runtime acceptance remains pending.

## 2026-09-27 16:03 PDT: real Loadout B probe, post-marker drift found

- Coordinated with QM implementer/planner and engine planner. Used only qmtest-rev-1790550053998, exactly one order, observer stream, then successful DELETE. No reviewer order remains. The run completed in 29.9 s, before the video window. No GBrain tool calls appear in the transcript.
- Initial project SOUL read-back matched SPEAR instructions; PATCH read-back matched HALBERD instructions. The same project-scope session returned a HALBERD-prefixed bridge reply. Transcript has marker at seq 5, then order at seq 14 with restated loadout; the order run is done/silent with a web-post reply.
- The first reviewer transcript assertion incorrectly searched payload.text at the beginning; group scope wraps it in a wake envelope. Corrected the read-only check to use payload.display and verified the existing conversation without another order. The live event-count/applied-event assertions were not reached; isolated fixtures cover those paths.
- **P2, B marker completion in server.ts:** raid-qm-plan identified guidance read/replace inside the marker run. Independent final SOUL GET confirms the stored text no longer equals soulContent: expected 311 characters, actual 719 with nested separators. The initial successful PUT/read-back is insufficient because the marker can rewrite it afterward. Reconcile exact current loadout after the marker, before dispatching the next order; retain flag gating and surface failed repair explicitly.
- B is not accepted yet. Analyst and implementer notified. A remains accepted with its documented catalog limitation. Evidence: /tmp/raid-qm-loadout-live-result.json, /tmp/raid-qm-loadout-verified-result.json, /tmp/raid-qm-loadout-soul-drift.json; session 892e955d-b4bd-4909-b4e5-0cec6bf127e9.

## 2026-09-27 16:05 PDT: Analyst hold and revised Plan A acceptance

- The planner identified the same marker-triggered guidance rewrite risk in Plan A's shared personal scope. The lead reports personal SOUL remains null; no shared-scope drift has been observed by this reviewer. Analyst holds real-unit Loadout PATCH until the fix is live. The preceding A acceptance is superseded by this safety hold.
- Revised A design from the Analyst: no QM marker turn, only a board activity event; order text prohibits guidance/system-prompt/QM-settings changes; bridge restores the personal SOUL startup baseline after turns if it drifted. Review the upcoming SHA and then use one non-B-prefixed qmtesta-rev unit: PATCH causes zero QM turns and one activity, one minimal order carries the guard and standing orders with no guidance call, personal SOUL unchanged, DELETE.
- Plan B is out of the demo per the latest Analyst decision. Its post-marker repair check can wait. Do not run the earlier proposed B marker-only probe. Avoid extra QM load during 16:10-16:20 and 16:33-16:43 video slots.
