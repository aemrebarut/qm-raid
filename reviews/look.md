# Look reviews

Owner: raid-look-rev. Review only; implementation belongs to the owners in docs/lanes/look.md.

## R1 baseline, 2026-09-27 15:28 PDT

Scope: mock board http://127.0.0.1:4619, current shared main. No real orders, reset, spawn or Forge training. Temporary isolated Playwright captures in `/tmp/raid-look-rev/baseline-*.png`; director-owned persistent iteration shots will supersede these. Reviewed overview, single selection, multi selection, Library, Forge, Barracks and local proposal at 1512x790; Library resized to 1280x720.

Validation: board TypeScript passes; board tests 11 pass / 55 assertions; browser page errors: zero. No code changes by reviewer.

### Actionable findings, most severe first

1. **P1, raid-look-panels: graph hover labels do not redraw after settling.** On a fully loaded 100-node, 200-link Library, moving to a node changed the canvas cursor to pointer but the canvas data URL stayed byte-identical. GraphView mousemove only sets `hover`; the stopped RAF is never restarted. Most nodes have no persistent label, so the graph's content becomes anonymous. Call `start()` when hover changes and when leaving. Also redraw on resize: after 1512x790 to 1280x720, the backing canvas stayed 1088x438 while CSS became 856x382. Acceptance: hover a rule or learning after 6 seconds of inactivity and read its label; resize both ways without blurred labels or incorrect picking.
2. **P1, raid-look-hud with raid-ui-hud: hidden Cancel buttons remain visible on completed runs.** Two `button.hud-btn.hud-btn-sm.hud-btn-cancel[hidden]` had computed display `block` and nonzero bounds. Baseline multi/proposals screenshots show Cancel beside Dismiss on a Done run. Source correctly sets `hidden`; the display override needs a scoped `[hidden]` rule. Acceptance: Done/failed/needs-human cards show only meaningful actions, running cards retain Cancel, and no hidden element paints or takes layout space.
3. **P1 visual, raid-look-hud: idle scaffolding competes with the board.** The empty sidebar and broad bottom parchment area are instruction paragraphs, the six empty command sockets remain prominent, and every number/resource uses an emoji. Use the specified dark slate and warm hairline surface, collapse the empty sidebar, make the transient hint small, use SVG icons and actual-model portraits. Acceptance: overview reads as a map with a restrained command frame; selected command slots remain obvious with hotkeys and distinct disabled states.
4. **P1 visual, raid-look-hud: global feed hides the play field and exposes transcripts.** Six long white lines span roughly half the map; visible examples include `Ada Ada: plan`, `Bram Bram: fixed`, a timestamped learning slug and `(engine fallback)`. Summarize the global feed as name + action + human object title, use relative time, constrain width, and reserve full replies for the selected detail view. Acceptance: busy feed readable on forest and paving, no repeated name, raw slug, epoch or backend qualifier.
5. **P1 visual, raid-look-panels: Forge presents model plumbing above results.** Cards expose `river://.../sampler_weights/...`, flat prose hides trained-versus-base evaluation, the form includes a tutorial paragraph, and the building identity repeats in overlay, sidebar and bottom. Use production cards with type, stage, progress, trained/base comparison, and a single Train command; move technical model identity to a tooltip. Acceptance: score comparison and next action are identifiable at a glance at both viewports; keep honest inferior and dry-run results distinguishable.
6. **P2 visual, raid-ui-hud: formation history repeats names and carries verbose UI copy.** `Planner Ada: Ada:` and `Implementer Bram: Bram:` are visible. Remove the leading repeated name; prefer `Runs`, `Proposals`, and `Go`; show relative time. Check terminal-state buttons along with item 2.
7. **P2 visual, raid-ui-scene via director: world plaques are tiny and repetitive.** Issue identifiers are nearly unreadable at the default full-map zoom. Building labels use `Forge · River`, `Library · GBrain`, and `Barracks · spawn agents`. Use the building's name alone and a screen-space size floor; reveal target detail on hover/selection rather than increasing every label's visual weight. Acceptance: a player can distinguish selectable units, issues and buildings without enlarging all map text.

### Blank Library clarification

The 350 ms baseline Library capture was empty with no loading state. After the response settled, the graph rendered 100 nodes / 200 links with 28,876 nontransparent canvas pixels and no exception. A permanent blank state is not independently reproduced in this pass. Keep a visible loading state, and resolve item 1's independently reproduced redraw defects. The director and panel owner received this correction.

### Owner delivery

Findings sent through Herdr default session to raid-look-dir, raid-look-hud, raid-look-panels, and raid-ui-hud. Director owns the shared punch list and screenshots; this log preserves independent evidence and acceptance checks.

## R2 director iteration i1, 2026-09-27 15:29 PDT

Evidence: all ten `docs/shots/look/i1-*.png` at fe9a0a0 visually inspected against the art-direction block in `docs/lanes/look-plan.md`. The director's owner list covers the main style failures in R1. Additional acceptance gaps sent to the director:

1. `i1-workflow.png`: Dismiss paints on a Running card, in addition to Cancel on Done. Treat both as R1 item 2's hidden-state defect; the fix should be scoped to every HUD hidden element.
2. `i1-target.png`: issue title, kind and status repeat in bottom and side. Apply the unit identity rule to targets too: bottom owns identity; side owns customers, engaged units and report.
3. `i1-feed.png` and `i1-workflow.png`: every handoff takes two global rows, one sent and one received. Collapse globally to one line (`Ada handed off to Bram`), preserving the separate unit histories.
4. Only 1512x790 files were in the supplied i1 set. Capture both requested viewport sizes in i2, especially the selected formation and simultaneous proposals states. This is an evidence gap, not a claim that the smaller layout is broken.

No additional blocker beyond R1. First-open Library now visible in persistent evidence; graph hover/resize lifecycle findings remain independently reproduced.
