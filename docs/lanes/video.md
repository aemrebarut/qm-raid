# Video team: the 1 to 2 minute submission demo video (Emre, 15:45). This is the main submission artifact.

Emre: "Make it fun, add voice over." Target 1:40 to 1:50, hard max 2:00, 1920x1080 mp4, H.264 + AAC.

## Agents and ownership
- raid-video (Opus 5.5 xhigh): capture and edit. Owns `apps/board/tools/video/capture.ts` and `apps/board/tools/video/assemble.*`. Playwright (see shoot.ts findPlaywright) with recordVideo at 1920x1080, scripted demo path, beat markers logged from the engine SSE, then ffmpeg assembly: trim each beat to its target length, speed ramp the waits (4x to 16x with a small fast-forward badge), lower-third captions injected into the page with page.evaluate (no board code changes), title and end cards, VO and music mixed in.
- raid-video-vo (Opus 5.5 xhigh): script, voice and sound. Owns `apps/board/tools/video/script.md` (narration per beat, word budget per beat at about 2.6 words per second) and `apps/board/tools/video/voice.*`. Voice: a local neural TTS if you can get it running in 10 minutes (Kokoro-82M via pip, a British male voice such as bm_george or bm_fable for the herald); fallback macOS `say -v Daniel`. No API keys. Optional: short unit acknowledgement barks in a second voice, and a quiet generated war-drum bed (ffmpeg synthesis only, nothing downloaded that is copyrighted). Deliver per-beat wav files plus a manifest with durations.
- raid-video-rev (gpt-6-astra xhigh): reviews the script at 16:00 (fun, accurate, no overclaims, honest numbers) and each assembled take: extract a frame every 3 s plus listen via transcript timing, check sync, pacing, legibility, errors on screen. Reply ends with VERDICT: APPROVED or VERDICT: CHANGES: <what>.

Output files go outside the repo: `~/Workspace/qm-raid-video/<take>/` (never commit video or audio). Code and script.md are committed.

## Tone
A medieval herald narrating a real-time strategy battle against a software backlog: playful, confident, quick. Jokes are welcome ("Your backlog has invaded"). Every claim must be true of what is on screen. Original words only; no Age of Empires audio, music or quotes.

## Beat sheet (targets; capture logs actual times; assembly fits each beat to its target)
- B0 0:00 to 0:06 Title: slow drift over the map, title "QM Raid", subtitle "Command your AI agents like an army".
- B1 0:06 to 0:14 Invasion: open issues as enemy camps, the top bar; press the new-issue button and a fresh camp appears.
- B2 0:14 to 0:32 First order: select a knight (a real QM agent on gpt-6-astra), right-click a camp; it marches, the blue recall beam from the Library (GBrain), working, the real QM reply, the gold remember orb flies into the Library and the page count ticks up.
- B3 0:32 to 0:40 It is real: open the unit's conversation in QM's own web UI (localhost:8129) if it loads without a login in the capture browser; never type credentials. Otherwise show the reply in the unit panel.
- B4 0:40 to 0:58 Teams: select three units, Form team, pick Trio (planner, implementer, reviewer), right-click a camp; handoffs light up; the reviewer's VERDICT: APPROVED.
- B5 0:58 to 1:16 The Forge (River AI): open the Forge, the refund ranger card with trained vs base (overall 0.82 vs 0.42 on held-out orders), Train unit, the new unit walks out and takes an order.
- B6 1:16 to 1:26 Autopilot: proposals appear with 15 second veto rings; cancel one, let one go.
- B7 1:26 to 1:34 Loadout: edit a unit's standing orders in game (only if shipped and green by the final take; otherwise redistribute the time to B2 and B5).
- B8 1:34 to 1:48 End: pull back over a busy map; end card "Built today by one human and 24 AI agents" plus github.com/aemrebarut/qm-raid and "River AI, GBrain, QM".

## Where and when
- Develop and dry run on the test board 4619 (mock engine 4618). Takes are recorded on the frozen demo board http://127.0.0.1:4621 (real engine 4610, real QM). Never 4611 (Emre's live board).
- Take windows on 4610, coordinated with raid-eng-plan (reset before each take, no engine, bridge or brain restarts inside a window): Take 1 16:10 to 16:20, final take 16:33 to 16:43.
- 16:00 script v1 to raid-video-rev and the Analyst. 16:08 capture dry run on 4619 green. 16:25 Take 1 assembled with VO (this is the fallback submission). 16:50 final take assembled. The Analyst hands the file to Emre, who uploads it.
- Kill only your own browser and ffmpeg PIDs, printed first.
