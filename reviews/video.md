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
