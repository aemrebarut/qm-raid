# UI review log

Reviewer: raid-ui-rev. Owner of this file only; implementation fixes go to the path owner.

## Review procedure

1. Read each submitted commit with `git show <sha>` and record its scope.
2. Check shared `contract/types.ts`, engine-only HTTP access, fixture fallback, and safe rendering of synthetic service text.
3. Run the board's smoke test and type/build checks once its scaffold exists. Record the commands and actual results.
4. Report actionable bugs, crashes, secrets, and contract mismatches to the implementer, most severe first. Copy raid-ui-plan on blockers.
5. Recheck fixes, append evidence here, commit only `reviews/ui.md`, and update `code/board-review` in the dev brain.

## M1 acceptance checks

- Board serves on 127.0.0.1:4611, proxies `/api` to 127.0.0.1:4610, and provides `/health` with `{ok: true, service: "board"}`.
- Type/build and service smoke commands succeed, with no imports from another service's implementation.
- Isometric scene mounts with zones, Library, Barracks, units, and targets from the state endpoint; unavailable engine shows fixture state.
- Unit and target selection agree between the scene and HUD. Empty selection and stale IDs do not crash either mount.
- Selected unit shows name, class, model, status, order, activity, and reply; selected target shows issue and customers.
- Message submission uses `/api/units/:id/message` with `{text}`; QM link is shown only when a session URL exists.
- Synthetic names, titles, messages, and replies render as text without creating executable markup.

## 2026-09-27 14:46 PDT: intake

- Read `docs/COMMON.md`, `docs/PLAN.md`, `docs/CONTRACT.md`, `contract/types.ts`, and `docs/lanes/ui.md`.
- Repository had no board implementation or submitted UI commit at intake. Build, smoke, and browser checks are pending, not passed.
- Asked Analyst to reconcile the contract example's numeric `Target.issue` and string memory timestamp with the shared types' string issue and numeric timestamp. Shared types are the current review reference.
- Asked Analyst to specify engine proxy routes for the M4 Library graph/search/page UI, preserving the engine-only dependency rule.
- Notified raid-ui-plan, raid-ui-scene, and raid-ui-hud in Herdr session `default` that review is ready.

## 2026-09-27 14:47 PDT: contract clarification

- Read contract v3 commit `75dc182` and the updated shared types. `contract/types.ts` is authoritative, timestamps are epoch milliseconds, and issue IDs are strings such as `LUM-12`.
- Library APIs are `GET /api/brain/graph`, `/api/brain/search?q=`, `/api/brain/page?slug=`, and `/api/brain/stats`. Slugs are URL-encoded query values, not path segments.
- Intake contract questions are resolved. Bridge terminal events now carry optional order IDs for stale-completion filtering in the engine; the board continues to consume only engine state/events.

## M1 scaffold review: b1a7c26

Scope: scaffold, core store/reducer, API, SSE, fixture, selection bus, main mounts, and health middleware. Read the submitted diff. Scene and HUD files were uncommitted work during this review.

### Open finding

- **P1: a delayed initial HTTP state response can undo newer SSE state.** `apps/board/src/core/sse.ts:12-15` starts GET `/api/state` concurrently with EventSource and unconditionally applies the HTTP result. Reproduced by delaying fetch, delivering a snapshot with u1 at (22, 22) plus an idle status event, then resolving fetch with the older fixture. The unit reverted to (5, 4), working. Ignore the HTTP result after accepting an SSE snapshot/event, or sequence initialization so an old HTTP response cannot replace newer stream state. Sent the reproduction to raid-ui-plan; request a regression check.

### Verification

- `cd apps/board && bun install`: passed, no dependency changes.
- `bun test test/`: 4 passed, 0 failed, 32 assertions.
- `bun run typecheck`: failed only at uncommitted HUD `sidePanel.ts` lines 104, 170, and 188, where nullable nodes are passed to append. No core diagnostics. Full board build is not approved yet.
- `bun run dev`: started Vite 8.3.1 successfully. Reviewer-started process listens only at 127.0.0.1:4611 (PID 60063); left running for the UI team.
- `curl -fsS http://127.0.0.1:4611/health`: returned `{"ok":true,"service":"board"}`. `/src/main.ts` served successfully.
- Browser render and scene/HUD integration remain pending their submitted commits.
- Read shared EngineEvent update `ca1a93d`. Lead notified to replace the local event union with the shared export; `forge.updated` now definitively carries `unitType`.
