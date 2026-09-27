# Video reviews

Reviewer: raid-video-rev. Author files are read-only. Verdicts are sent to the author by Herdr name in session `default`, with Analyst copied. Render evidence stays outside the repo in reviewer scratch.

## V1: narration script 0632c7d (2026-09-27, 15:53 PDT)

Reviewed `video/script.md`, intro storyboard, timeline, engine veto setting, QM loadout application, Forge loadout limitations, and River evaluation evidence in `reviews/solo.md` and the Forge devbrain page.

- Tone is playful and the four intro claims match the intended product. No em or en dashes in script or storyboard.
- Independently counted 30 named raid agents plus Analyst in Herdr: 31 supports the updated end card. The engine veto window is 15000 ms.
- P2: the loadout narration says every unit carries skills/plugins into its next order. Forge stores skills but does not use them. Scope this clip to a QM unit and the saved standing orders shown on screen.
- P2: actual whitespace word counts are 47 for Orders and 47 for Forge. At the declared 2.6 words per second, each needs about 18.1 seconds plus the 1.2 second title card, exceeding the script's 80 percent voice budget. Shorten or demonstrate measured WAV fits with breathing room. Autopilot is 30 words, not 29.
- Evaluation evidence supports 32 held-out prompt phrasings for Refund Ranger, not unseen-issue generalization. Keep that distinction in captions and narration. Real-QM, recall, remember, page increase, reviewer approval, and loadout effect remain capture-dependent claims.

Sent to raid-video-vo, raid-video and Analyst.

VERDICT: CHANGES: scope loadout to QM, correct counts, and make the two 20 s narration slots breathe.

## V2: capture claim and marker preparation (15:55 PDT)

Read `apps/board/tools/video/capture.ts` while checking the source of forthcoming manifests. Two concrete risks to honest rendered claims were sent to raid-video-cap, raid-video and Analyst:

- P2: Forge selects the first ready type whose name contains refund. The older Refund Ranger scored 0.66 vs 0.73; only `forge-refund-ranger-2` supports 0.82 vs 0.42. Select an exact type ID and carry it into card and train markers.
- P2: named verdict extraction tests for APPROVED anywhere before CHANGES anywhere. A quoted earlier approval followed by a final CHANGES would produce an approval marker. Extract the final verdict line and retain visible default approval or template fallback information.
- The current loadout capture stops after Apply. Showing the next order carry changed instructions requires a follow-on capture.

VERDICT: CHANGES: bind the Forge take to its exact model and mark the final reviewer verdict honestly.

## V3: FX gallery render (15:56 PDT)

File: `~/Workspace/qm-raid-video/fx/fx-gallery.mp4`. SHA256: `199fc9af4f5bfab60c593faac2dd9fc847ef3c990d03df22c98041fccd5db914`.

- Clean full video decode, 33.867 seconds, 1920x1080 H.264 at 30 fps, stable during inspection. No audio stream, as expected for a visual gallery. Audio sync is not approved by this review.
- Extracted and inspected 17 full-resolution frames at 0, 2, ... 32 seconds; added 3, 27 and 33.4 second samples for short callout/mascot/transition beats.
- Callouts, recall label, page pop, approval stamp, score bars, and mascot captions are legible. Fun visual treatment fits the storyboard. No blocker in the sampled visuals.
- The rendered gallery uses Refund Ranger and 0.82/0.42. The newer Rule Warden name and score props in current source still need render verification. Gallery counts are synthetic showcase inputs, not evidence for final cut claims.
- Evidence: `/tmp/raid-video-rev/fx-fx-gallery-199fc9af4f/` (probe, exact timestamps, frames, contact sheets, decode log).

Sent to raid-video-fx, raid-video and Analyst. Scope: visual component gallery only.

VERDICT: APPROVED

## V7: intro draft2 and script v2 (16:04-16:05 PDT)

Intro file `intro/intro-draft2.mp4`, SHA256 prefix `6edb7f9e82`: exactly 11 seconds, clean stable 1080p H.264 at 30 fps. Inspected every 2 seconds and an additional full-resolution frame at 8.5 seconds. Forge nameplate is now separate from its heading; Library plaque is corrected. Four claims and finale remain legible. Scope: silent anime component at final time 2-13 seconds. Sent to raid-video-intro, raid-video and Analyst.

VERDICT: APPROVED

Script v2 `75a0aa4`: independently counted 121 spoken words and checked all 18 active WAV durations against the manifest. No voice-file overlaps in the manifest, no section spillover, last line ends 74.797 seconds. Claims are correctly narrowed to knight standing orders and the exact two evaluated River types. No em or en dashes. Final capture accuracy and mixed-render timing remain separate checks. Sent to raid-video-vo, raid-video and Analyst.

VERDICT: APPROVED

## V8: dry4 Teams (16:06 PDT)

`dry4/clips/teams.mp4`, SHA256 prefix `9a01dc32ff`, 37.967 seconds, clean stable 1080p H.264 at 30 fps. Inspected 19 samples every 2 seconds. Exactly three units selected; marker roles are planner:u1, implementer:u2, reviewer:u7. The handoff reaches Rule Warden u7 at 23.439 seconds, and it emits final APPROVED at 32.346. No capture failures or visible reset. Wrong-reviewer finding resolved for this mock dry run. Sent to raid-video-cap and Analyst.

VERDICT: APPROVED

## V9: edited audio placement preflight (16:06 PDT)

Current `Main.tsx` moves narration to EDL anchors, then clamps each line against section end. The clamp can override the previous line's end and reintroduce overlaps. Reproduced with current EDL: vo_orders_2 at 22.400-25.180, vo_orders_3 at 24.967-27.907, an overlap of about 0.213 seconds. The source manifest itself has no overlap. Resolve the section's schedule together or fall back to its manifest offsets when anchors cannot fit. Sent to raid-video and Analyst.

VERDICT: CHANGES: prevent the end-clamp from reintroducing voice overlap.

## V4: intro draft render (15:59 PDT)

File: `~/Workspace/qm-raid-video/intro/intro-draft.mp4`. SHA256: `da6464753f6e997e797b2bb3ea055c2d8f757dc2a8793e0327fdb752eb8d1632`.

- Exactly 15 seconds, 1920x1080 H.264 at 30 fps, stable file and clean full decode. Silent draft, with no audio stream or final manifest available; audio sync remains pending.
- Extracted and inspected every 2 seconds from 0 through 14. Also inspected author midpoint frames at 5.5, 7, 11.5 and 14 seconds. Main headings, squad labels and finale are legible. Visuals have the requested anime energy and original chibi treatment.
- P2 at 11.5 seconds: the Refund Ranger new-unit nameplate is behind the large River heading, obscuring its text. Move it into free space beneath the heading or above the unit.
- Minor polish: the GBrain Library plaque text at 7 seconds extends beyond the plaque box.
- Evidence: `/tmp/raid-video-rev/intro-intro-draft-da6464753f/`; collision also visible in the author's `intro/frames/t11.5.png`.

Sent to raid-video-intro, raid-video and Analyst.

VERDICT: CHANGES: separate the Forge unit nameplate from the headline.

## V5: dry3 Orders and Teams captures (16:00 PDT)

Files: `~/Workspace/qm-raid-video/dry3/clips/orders.mp4` (SHA256 prefix `7264f12b5b`, 18.233 seconds) and `teams.mp4` (`ff40860020`, 44.667 seconds). Both are mock-board dry runs, 1920x1080 H.264 at 30 fps, silent, stable and cleanly decoded. Inspected every 2 seconds, 10 and 23 samples respectively, against their marker manifests.

- P1 Teams: 14-16 second frames show four selected units. The trio marker lists `[u2,u6,u3,u7]`, despite the intended three `[u2,u3,u7]`. The actual reviewer handoff at 31.680 seconds goes to u3 (Cato), and Cato emits approval at 39.196. Rule Warden u7 stays idle. The revised narration's Rule Warden reviewer claim would be false for this take. Assert exact selection and workflow role bindings before the real capture.
- Orders: the board/selection visibly resets around 12 seconds. The manifest records `ReferenceError: capPos is not defined` at 16.673; the Library and page delta evidence is missing. Use a stable page and restore helpers after navigation.
- Final verdict extraction is improved in these manifests: the final CHANGES and APPROVED lines are both recorded. This resolves the earlier parser finding for the inspected replies.
- Evidence: `/tmp/raid-video-rev/clips-orders-7264f12b5b/` and `/tmp/raid-video-rev/clips-teams-ff40860020/`.

Sent to raid-video-cap, raid-video and Analyst.

VERDICT: CHANGES: fix team membership/reviewer binding and recapture Orders without the page reset.

## Opening requirement update (Analyst relaying Emre, 15:58 PDT)

The final opening must start with 2 seconds of real gameplay, sharp from frame 0, followed by 13 seconds of anime. The full intro section remains 15 seconds. Review the exact first frame and the exported `thumbnail.png`, the smash cut at 2 seconds, and the retimed intro manifest. The previous 15 second silent anime draft does not establish compliance with this updated requirement.

## Structure superseded: 75 second total (Analyst relaying Emre)

The Update 16:03 at the top of `docs/lanes/video.md` now controls: hero 0-2, anime 2-13 (11 seconds), Orders 13-28, Teams 28-42, Forge 42-57, command montage 57-71, end 71-75. The command montage includes new issue, veto and a 3 second Loadout edit. Narration target is about 170 words. Prior pacing findings must be reevaluated against the new script and measured audio.

## V6: remaining dry3 captures (16:02 PDT)

All three files are in `~/Workspace/qm-raid-video/dry3/clips/`, 1920x1080 H.264 at 30 fps, silent, stable and cleanly decoded. Full-resolution samples every 2 seconds were inspected against the corresponding marker manifests.

- Forge: SHA256 prefix `05aa1a4138`, 26.50 seconds, 14 samples. Exact checkpoint selection is corrected. Markers report Refund Ranger -2 overall 0.821 vs 0.424 and Rule Warden 0.917 vs 0.557. The panel disappears by the 14 second frame, before the later card marker; capPos errors at 24.898 prevent follow-on work. The dev reload makes the later markers unsuitable for editing.
- Autopilot: `65c32a6a27`, 10.367 seconds, 6 samples. New issue appears, then a page reload and execution-context error at 8.752. No veto or proposal sequence is captured.
- The capture author attributes reloads to the shared dev board. Commit 93fa813 restores helpers with an init script and pins exact Trio selection and reviewer binding. Read the diff; corrected runtime binding awaits dry4. Real takes use the frozen board.

Sent to raid-video-cap and Analyst, with editor summary.

VERDICT: CHANGES: replace the interrupted Forge and Autopilot dry captures.

Loadout: `7b9e243a42`, 22.30 seconds, 12 samples. Edit/save visible at 4-12 seconds. Applied marker at 9.264 records standing orders, debug skill and gbrain. Follow-on order at 13.640 and recall/reply are visible at 16-22 seconds. No failure notes. The final 3 second edit needs a panel close-up for legibility. Scope is mock dry-run recording quality, not a real-backend submission.

Sent to raid-video-cap and Analyst, with editor summary.

VERDICT: APPROVED


## V10: final intro and remaining dry4 (16:08 PDT)

- Intro `intro-draft3.mp4`, SHA256 prefix `661fd51a18`: 11 seconds, clean stable 1080p H.264 at 30 fps, six samples every 2 seconds. The +1 PAGE burst is now fully legible; previous fixes remain. Sent to raid-video-intro and Analyst.

VERDICT: APPROVED

- Hero `dry4/clips/hero.mp4`, `d3546dd170`: 11.533 seconds, clean stable 1080p H.264 at 30 fps, six samples every 2 seconds. Sharp map from frame 0; recall beam visible around 5-6 seconds. No capture failures. Scope is mock hero framing; the final opening must use the equivalent real-capture moment. Sent to raid-video-cap and Analyst.

VERDICT: APPROVED

- Autopilot `dry4/clips/autopilot.mp4`, `73b2361cf1`: 34 seconds, clean stable 1080p H.264 at 30 fps, 17 samples every 2 seconds. Proposals at 11.042 and activation at 26.198 establish the 15 second expiry. `veto_missing` at 17.552 and no order_cancelled event mean no successful cancellation was captured, despite failures being empty. Fix the Cancel action and verify its specific order cancellation, or omit that beat. Sent to raid-video-cap, raid-video and Analyst.

VERDICT: CHANGES: capture one confirmed cancellation or omit the successful-veto beat.

## Final deadline and structure (latest Analyst update)

Take 1 is the only final take. Update 16:08 restores target 1:50, max 2:00: hero 0-2, approved anime 2-13, Orders 13-35, Teams 35-55, Forge 55-75, Autopilot/new issues 75-92, approved mock Loadout close-up 92-104, end 104-110. New narration is targeted for 16:15. Final mp4 plus thumbnail are due 16:24; reviewer performs a fast frame-sheet and sync check for P1 blockers from 16:24 to 16:26. Prior 75 second schedule is superseded.

## V11: audio scheduling and script v3 (16:10-16:16 PDT)

The editor extracted shared `voPlace.ts` scheduling and resolves each section with forward/backward passes. The effective placement check now reports no overlaps, resolving the earlier 0.213 second collision. Rechecked with the 1:50 manifest and current EDL: 109.733 second composition, no overlaps. Sent scoped scheduler approval to raid-video and Analyst. Final mixed-render sync remains pending.

VERDICT: APPROVED

Script v3 `56d69aa`: independently counted 180 words and measured 79.941 seconds of active speech. All 25 active/alternate WAV durations match the manifest within rounding, no voice-file overlaps, and no em or en dashes. Jokes, held-out wording, knight Loadout scope and conditional QM/Warden/veto lines pass. One prose number needs correction: Loadout has 12 - 8.663 = 3.337 seconds without narration, so 'every clip keeps at least 4 s without narration' should read 'every capability clip keeps at least 3 s without narration'. No audio regeneration required. Sent to raid-video-vo and Analyst.

VERDICT: CHANGES: correct the written breathing-room sentence to at least 3 seconds.
