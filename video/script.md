# QM Raid demo: narration script v2, 75 s cut (raid-video-vo)

Structure (docs/lanes/video.md, Update 16:03; raid-video 155ca6c): hero 0 to 2 (gameplay, no VO), intro 2 to 13, orders 13 to 28, teams 28 to 42, forge 42 to 57, command 57 to 71, end 71 to 75. Clip title cards are 1.0 s; the herald starts after them.

Voices: ElevenLabs eleven_v3 stock voices, Harry (hype anime announcer) for the intro, George (warm British herald) for everything after. Kokoro-82M (tts.py) is the local fallback. Durations below are measured on the delivered wavs (silence trimmed, -16 LUFS).

Words: 121 spoken (about 53 s of speech in 75 s). The 170 word target would need about 70 s of speech at George's measured pace, leaving no air, so each clip keeps 3 to 7 s of silence for the game sounds and the reviewer's breathing-room request.

## Intro (hype announcer, ElevenLabs Harry; beats from raid-video-intro) 0:02 to 0:13 (11 s slot, 10.0 s speech, 23 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_intro_1 | 2.1 | 2.02 | Your issues are monsters! |
| vo_intro_2 | 4.3 | 2.05 | Your AI agents are units! |
| vo_intro_3 | 6.45 | 1.94 | GBrain is their shared memory! |
| vo_intro_4 | 8.65 | 2.12 | River forges new unit types! |
| vo_intro_5 | 10.9 | 1.9 | This is QM RAID! |

## Clip 1 Orders and memory 0:13 to 0:28 (15 s slot, 10.2 s speech, 25 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_orders_1 | 14.3 | 4.44 | Hear ye! Order a knight, a real QM agent, to a camp. |
| vo_orders_2 | 20.21 | 2.78 | Blue beam: it recalls from GBrain. |
| vo_orders_3 | 24.46 | 2.94 | Gold orb: it remembers what it learned. |

## Clip 2 Teams 0:28 to 0:42 (14 s slot, 6.5 s speech, 14 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_teams_1 | 29.3 | 2.87 | Three units, one team: the Trio. |
| vo_teams_2 | 35.0 | 1.78 | The reviewer checks the house rules. |
| vo_teams_3 | 39.6 | 1.8 | Verdict: approved! |
| vo_teams_2b (alt) | 35.0 | 3.2 | The reviewer is a Rule Warden, forged by River. |
| vo_teams_3b (alt) | 39.6 | 2.97 | Verdict: changes! Back to work. |

## Clip 3 The Forge (River AI) 0:42 to 0:57 (15 s slot, 11.9 s speech, 27 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_forge_1 | 43.3 | 4.16 | At the Forge, River fine-tunes new unit types. |
| vo_forge_2 | 48.04 | 5.8 | Refund Ranger, Rule Warden: each beats its base model on held-out test orders. |
| vo_forge_3 | 54.43 | 1.97 | Train one, and out it walks! |

## Clip 4 Command montage (new issue, autopilot veto, 3 s Loadout edit) 0:57 to 1:11 (14 s slot, 10.7 s speech, 25 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_auto_1 | 58.3 | 2.8 | A new issue? A fresh camp appears. |
| vo_auto_2 | 61.81 | 4.43 | Autopilot proposes orders, with a fifteen second veto. |
| vo_loadout_1 | 66.96 | 3.44 | And a knight's standing orders? Rewrite them in the game. |

## End card 1:11 to 1:15 (4 s slot, 3.5 s speech, 7 words)
| id | at (video s) | dur (s) | line |
|---|---|---|---|
| vo_end | 71.3 | 3.5 | One human. Thirty-one AI agents. Built today. |
| vo_end_b (alt) | 71 | 3.51 | One human, a swarm of AI agents, built today. |

Alts: `vo_teams_2b` names the Rule Warden; use it only if raid-video-cap confirms the Rule Warden reviewed in the take (default `vo_teams_2` does not name it). `vo_teams_3b` if the take shows CHANGES. `vo_end_b` has no number.

## Evidence for claims (for raid-video-rev)
- "a real QM agent": knight = QM agent on gpt-6-astra (docs/CONTRACT.md class map); takes run on the real engine 4610 with real QM.
- "recalls from GBrain" / "it remembers what it learned": blue recall beam and gold remember orb (README, COMMON.md); the page count rises on screen.
- "checks the house rules": default reviewer instructions in docs/CONTRACT.md. Rule Warden only in the alt (see above).
- "River fine-tunes new unit types": river/runs/forge-refund-ranger-2/model.json (River checkpoint on Qwen/Qwen3.5-9B); forge-rule-warden from the Analyst (GET 127.0.0.1:4612/types/forge-rule-warden/eval).
- "each beats its base model on held-out test orders": Refund Ranger 0.82 vs 0.42, Rule Warden 0.917 vs 0.557 on 32 held-out review orders (docs/lanes/video.md 16:03 and the Analyst). Held-out orders are new phrasings of known synthetic issues, so the VO does not claim unseen issues. Numbers only on the cards, not in the VO.
- "fifteen second veto": services/engine/src/config.ts:22 `VETO_WINDOW_MS = 15000`.
- "a knight's standing orders ... rewrite them in the game": scoped to a QM knight (Loadout tab, PATCH /api/units/:id instructions; docs/CONTRACT.md Loadout). No claim about skills or plugins on Forge units.
- "Thirty-one AI agents": herdr agent list at 15:47, 30 raid-* agents plus the Analyst; raid-video-rev counted independently.

## Sound (all original, generated for this video)
- ElevenLabs sound effects: impact, whoosh, land, glint, beam, orb, hammer, sparkle, riser, clash, slam, chime, scroll. Intro cues sit on raid-video-intro's hit times (smash cut 2.00, unit lands 4.47/4.70/4.93, beam 6.63, orb 7.90, hammers 8.87/9.20/9.53, clash 11.20, logo slam 11.27, wipe 12.60); a whoosh on each clip card and a chime on the end card. SFX at -20 LUFS.
- ElevenLabs music (instrumental, original prompt): `music.wav` 75 s = the anime opener's last 13 s from frame 0 (its final hit lands on the title drop), then a quiet medieval march bed at -30 LUFS from 12.5 s, fading out at the end.
- Extras for the editor: sfx_scroll (handoff), sfx_hammer (Train unit), sfx_chime (APPROVED stamp), sfx_beam and sfx_orb (recall and remember in clips).

Files: `video/audio/<id>.wav` (gitignored, = line ids), `video/audio/manifest.json`. Regenerate: `python3 video/audio/eleven.py` (key read from video/.env inside the script), then `python3 video/audio/manifest.py`. Fallback: `tts.py` then `manifest.py kokoro`.
