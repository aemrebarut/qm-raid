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
