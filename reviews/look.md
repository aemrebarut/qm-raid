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

## R3 theme foundation bdb8bb9, 2026-09-27 15:31 PDT

Reviewed the token and SVG icon commit. **P2, raid-look-hud:** `icon(name, size)` writes SVG width/height attributes, but `.lk-icon { width: 1em; height: 1em }` overrides them. An actual Chrome probe with committed tokens and a 13 px parent measured default, 20 px and 32 px requests all at 13x13. Use explicit inline dimensions or a CSS custom property when size is supplied. Acceptance: command icons and crests honor requested dimensions while the default remains 1em. Also noted the unused `--lk-drop` 24 px blur exceeds the director's 12 px outer-shadow cap; align before use. No other actionable finding in this foundation-only commit.

## R4 panels 70393a2 and cde51a1, 2026-09-27 15:39 PDT

**Verdict: core panel behavior passes; two P2 followups sent to raid-look-panels.** Visually inspected both Library sizes and Forge at 1280 using the new slate treatment. It meets the hierarchy change: restrained header, graph as the main content, compact memory rows, readable trained/base bars and a clear delta. No visible model URI in the Forge body; Dry types remain identifiable. Source review of 70393a2 and the cde51a1 graph followup completed.

Validation on 4619, with HMR disabled only in the isolated review browser to avoid mid-test reloads:
- Controlled five-node graph fixture: offline message, recovery on reopen, hover redraw, click-to-page, and 1512x790 to 1280x720 resize pass. Backing canvas and CSS dimensions both 916x411 after resize. Zero page errors. Screenshots `/tmp/raid-look-rev/r4-library-fixture*.png` and `r4-forge-1280.png`.
- Real mock-board graph recovered: 91 pages, 252 links in the inspected live narrow shot; product, four components, rules and issue labels visible. The earlier 100-page graph lost anchors and subsequent API calls returned 502; brain owner was informed and reported pagination work in flight. This was data availability, separate from panel rendering.
- Existing core, panel-race and SSE tests: 12 pass / 66 assertions. A transient HUD working-tree TS2367 was reported to its owner; latest full board TypeScript check passes.

Findings:
1. **P2, search clear race.** Submit `billing`, clear the field before a 500 ms search response, then the old result reappears under an empty Search input. Browser repro returned `query: ""`, `results: "Billing rules / Invoice retry"`. Invalidate `searchGen` when clearing, not just when submitting a new search. Acceptance: clearing before response keeps results empty.
2. **P2, fallback human titles.** `slugTitle('learnings/dev-u1-1790547966120')` returns `Dev u1 1790547966120`; a non-uN actor likewise exposes the epoch. The mandatory busy-feed fixture uses dev learning slugs. Handle all learning slugs without exposing the timestamp or actor identifier. Acceptance: no 13-digit epoch in any Library graph, search or memory label, including local dev events and forged agents.

Additional narrow i1 evidence (overview, unit, workflow, Library, Forge) and the icon contact sheet were inspected. The formation history falls below the fold at 1280, already covered by the director's roster/formation redesign; no new blocker beyond the recorded findings.

## R5 HUD 15698d3, e346453 and 9e16717, 2026-09-27 15:54 PDT

**Verdict: reskin and reply-expansion fix pass.** The initial 15698d3 review found a P1: clicking a long reply toggled a class without removing its three-line clamp, making the removed Last reply content inaccessible. Reported directly to raid-look-hud and director; 9e16717 fixes it with a chevron button and expanded-state CSS. Independent Chrome repro on 4619: before 52 px visible / 539 px content, after 539 / 539, clamp none, aria-expanded true. No page errors, no painted hidden elements, and 20 px / 32 px icon requests measure correctly. This closes R1 item 2 and R3.

Reviewed e346453 Loadout integration and i2 evidence at both sizes. Slate treatment and tab navigation are present. The narrow shot still has native left checkboxes and a tall list rather than the requested right-side switches; this is visual followup, not a functional failure. Board TypeScript passes and all 20 board tests / 119 assertions pass, including Loadout draft retention and Apply behavior. Earlier scene WIP type errors are absent in this run.

Capture gaps sent to director: i2-loadout.png shows unselected overview, i2-workflow images do not show a running workflow, and i2-rolepick images show the preset grid rather than active role selection. These files do not establish coverage of the named states. Assert state before taking the next shot; shared mock team edits can invalidate fixed team assumptions.

## R6 panels aa3d28b, 2026-09-27 15:54 PDT

**Verdict: R4 P2 fixes pass.** Source reviewed after the Analyst's approved per-command Git workaround restored access. Changes were not attributed to a commit until aa3d28b was supplied.

- Delayed search: submit, immediately clear, wait for response. Query and results both remain empty.
- Learning titles: owner tests cover dev-u1, ordinary uN, forged actor names and epochs; all pass.
- Hover card: pan a node 20 px above the graph bottom. Tooltip bottom 580.28 px, field bottom 589 px, no clipping. Hover redraw and click-to-page still pass; at 1280 backing canvas and CSS both 916x411. Offline-to-reopen recovery passes. Zero page errors.
- Forge fallback: actual mock state displays trained/base Style, Grounded, Overall and Verdict metrics without model URIs, and Dry types say No eval score. Full endpoint rendering is being checked with a routed synthetic payload because the mock endpoint is not yet available.

## R7 iteration i3, initial pass 2026-09-27 15:54 PDT

Art-on overview, unit, Library, Forge and proposals inspected against the director's art-direction block. World labels are now legible, model portraits read clearly, Library uses the field well, and Forge results are scannable. Main HUD no longer reads as parchment scaffolding.

1. **P2, raid-look-hud: compact proposals truncate the issue identifier.** In i3-proposals.png rows show Ada > LUM-10..., Bram > LUM-1..., Cato > LUM-1...; Cancel, Adjust and Go occupy most of the 320 px row. Preserve the full short issue ID and unit name before any optional title. Use the planned icon controls for secondary actions. Acceptance: distinguish LUM-101, LUM-102 and LUM-103 beside each Go button at both viewports. Sent to owner and director.
2. **P2 visual, raid-look-hud: empty Activity remains a blank well.** i3-unit.png repeats Activity as tab and section header, then reserves roughly 100 px for an empty feed. Collapse that section when empty so the message composer anchors to content. Sent to owner and director.


### R6-R7 followup, 2026-09-27 16:00 PDT

Full Forge endpoint rendering passes with a routed synthetic payload at 1280: Overall 0.66 versus 0.73 gives -0.07 in danger red; Grounded 0.52 versus 0.66 gives -0.14. Training statistics and two sample columns render, no horizontal overflow (530 px client and scroll width). This is fixture validation, not a claim that the live endpoint has landed.

All 32 i3 images inspected. Additional coverage caveat: i3-formation-1280.png shows the fallback FIXTURE backend and a different map. Director notified and capture setup assertions are now in 28fc9b7. 54b3d61 group summary uses its space well; New issue slate treatment matches the HUD. 8ecc599 right-aligned Loadout switches visually pass in a fresh 1280 capture, with reachable Apply and no browser page errors. Empty Activity CSS reviewed; next fixed-state shot will confirm its appearance.

**P2 integration, raid-look-hud:** Message command is swallowed while Loadout is active. Repro: select a unit, open Loadout, click Message in the command card. Loadout remains aria-selected=true and keyboard focus stays on the command button. SidePanel.focusMessage only focuses when the hidden composer is already visible. Switch to Activity before focusing. Reported to HUD owner and director; no message was sent.

Resource discipline after the Analyst's 15:57 notice: at most one short-lived browser at a time, closed after each check; use saved captures and source review where sufficient. Devbrain code/look-review update confirmed by a read after the initial asynchronous write receipt.

## R8 Library index 6caa194 and fix 32864eb, 2026-09-27 16:03 PDT

**P2 found and closed.** The new index is visually useful and its degree ordering is straightforward. Independent isolated Library-only browser test avoids the 3D scene: 24 synthetic graph nodes, 20 issues, routed page response, 1280x720. Clicking the last issue after scrolling the index inserted its page above the retained scroll position. Before fix: page top -239 px, sidebar visible 57..551 px, scrollTop 349. The page also shrank to 23 px. Reported to owner and director.

32864eb rerun passes: page top 65 px, bottom 384.39 px, sidebar visible 57..551 px, scrollTop 45. Title and body are readable, the page has its own scroll area, and index stays below. Before/after evidence in `/tmp/raid-look-rev/r8-index-scroll-1280.png` and `r8-index-scroll-fixed-1280.png`. Browser closed immediately. No new issue in this followup.

### Additional HUD reviews

- dfe726c: source and a3 minimap screenshots inspected. Muted terrain, building-system accents and selected rings align with the brief. Duplicate sender text and proposal feed duplication are removed; learning fallback titles no longer produce fake acronym labels.
- 7154cd4: source reviewed. Short team names remain available at 1280, and an empty Activity section collapses rather than reserving blank space.
- a3-loadout.png exposed Formation presets above the Loadout contents. Sent to HUD/UI owners and director. 6498d77 adds a scoped CSS visibility rule for the selected Loadout tab; next combined screenshot check will verify under team updates.
- a3-workflow.png and a3-rolepick.png now show the named states. Their local team fixture still mixes Red membership with green member portraits and another team's role badges; director notified to align member unit.team with the local fixture before using these for role signoff.
- Message command P2 is confirmed by its owner; TS fix intentionally queued until W2 rehearsal ends around 16:08. No request to interrupt that rehearsal.
