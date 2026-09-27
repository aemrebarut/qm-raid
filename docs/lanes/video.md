# Video team: the 1 to 2 minute submission demo video (Emre, 15:45). This is the main submission artifact.

Emre: "Make it fun, add voice over." Emre 15:50: a 15 second fun intro that introduces our approach, anime style, like the first 15 seconds of a good YouTube video; then 90 seconds of 15 to 20 second clips, one per capability; the team makes the video itself, with Remotion. Target 1:45 to 1:55, hard max 2:00, 1920x1080 mp4, H.264 + AAC.

## Agents and ownership
- raid-video (Opus 5.5 xhigh, lead and editor): owns `video/` (a Remotion project, its own package.json; a microservice like the rest) except `video/src/intro/`. First 8 minutes: scaffold Remotion, register compositions `Intro` (15 s, owned by raid-video-intro) and `Main` (the full cut), commit, tell the others. Then Main: intro, the five clips as OffthreadVideo with speed ramps (playbackRate, a small fast-forward badge when above 2x), lower-third captions and clip title cards in the game's gold-on-stone style, snappy transitions, the VO and music tracks, end card. Renders to `~/Workspace/qm-raid-video/<take>/qm-raid-demo.mp4`, 1920x1080, H.264 + AAC.
- raid-video-intro (Opus 5.5 xhigh): owns `video/src/intro/`. The 15 second anime-style opener, fully code-drawn in Remotion (SVG and CSS): speed lines, impact frames, a dramatic zoom and screen shake, big bold title cards, sparkles, a chibi squad of agent units (you may use stills of our own units from the art showroom http://127.0.0.1:4620 or the board), the backlog as a monster horde. It must introduce the approach in plain words: your issues are monsters, your AI agents are units, GBrain is their shared memory, River forges new unit types. Fun first, legible second, no copyrighted characters, music or sound.
- raid-video-cap (Opus 5.5 xhigh): owns `apps/board/tools/video/capture.ts`. Playwright (see shoot.ts findPlaywright) recordVideo at 1920x1080, one raw clip per capability, scripted from the engine state and SSE with a markers JSON (event times inside each clip) so the editor can cut and ramp. Clean frames: hide the cursor or use a tidy one, no dev overlays.
- raid-video-vo (Opus 5.5 xhigh): owns `video/audio/` and `video/script.md`. Narration per section (about 2.6 words per second), a hype announcer for the intro and a medieval herald for the clips. Local neural TTS if running within 10 minutes (Kokoro-82M via pip; for example bm_george or bm_fable; a brighter voice for the anime intro); fallback macOS `say -v Daniel`. No API keys. Sound: code-generated whooshes and impact hits for the intro and a quiet drum bed (ffmpeg or Web Audio synthesis only). Deliver wav files plus `video/audio/manifest.json` with durations.
- raid-video-fx (Opus 5.5 xhigh, added 15:55, Emre: "Add some fun animations"): owns `video/src/fx/`, reusable animated overlays that raid-video places on the clips at the capture markers: punch-in zooms on key moments, animated callout arrows and rings (the recall beam, the Library, the Forge card), '+1 page' pops when a memory lands, a big stamped 'APPROVED!' on the reviewer verdict, a 'NEW UNIT FORGED!' burst, a score bar race for trained vs base, combo counters for tokens and orders, chibi mascot reactions in a corner, and speed-line wipes between clips that echo the intro. Same art direction as the intro (coordinate with raid-video-intro), gold-on-stone palette of the game.
- raid-video-rev (gpt-6-astra xhigh): reviews script.md at 16:02 and every render: frames every 2 s, audio sync, pacing, legibility, errors on screen, overclaims. Ends with VERDICT: APPROVED or VERDICT: CHANGES: <what>.

Output files stay outside the repo (`~/Workspace/qm-raid-video/`); never commit video, audio or node_modules. Code, script.md and the manifest are committed.

## Tone
Intro: anime opening energy, fast and funny. Clips: a herald narrating a real-time strategy battle against a software backlog; playful, quick. Every claim must be true of what is on screen. Original words, art and sound only.

## Structure (targets)
- 0:00 to 0:15 Intro (anime).
- Clip 1, 20 s, Orders and memory: select a knight (a real QM agent on gpt-6-astra), right-click a camp; it marches, the blue recall beam from the Library (GBrain), the real QM reply, the gold remember orb, page count up; a 2 s cut to the same conversation in QM's own web UI (localhost:8129) only if it loads without a login; never type credentials.
- Clip 2, 20 s, Teams: select three units, Form team, Trio (planner, implementer, reviewer), right-click a camp, handoffs light up, VERDICT: APPROVED.
- Clip 3, 20 s, The Forge (River AI): describe a type, the refund ranger card with trained vs base (overall 0.82 vs 0.42 on held-out orders), Train unit, it walks out and takes an order.
- Clip 4, 15 s, Autopilot and new issues: press the new-issue button, a camp appears; autopilot proposals with 15 second veto rings; cancel one, let one go.
- Clip 5, 15 s, Loadout: edit a unit's standing orders and skills in game (only if shipped and green by the final take; otherwise give its time to clips 1 and 3).
- End card 4 s: "Built today by one human and 24 AI agents", github.com/aemrebarut/qm-raid, "River AI, GBrain, QM".

## Where and when
- Develop and dry run captures on the test board 4619 (mock engine 4618). Real takes on the frozen demo board http://127.0.0.1:4621 (real engine 4610, real QM). Never 4611 (Emre's live board).
- Take windows on 4610, coordinated with raid-eng-plan (reset before, no engine, bridge or brain restarts inside): Take 1 16:10 to 16:20, final 16:33 to 16:43.
- 16:02 script v1 to raid-video-rev and the Analyst. 16:08 intro draft render and capture dry run. 16:25 Take 1 cut rendered with VO (the fallback submission). 16:50 final cut rendered. The Analyst hands the file to Emre for upload.
- Kill only your own browser, Remotion and ffmpeg PIDs, printed first.
