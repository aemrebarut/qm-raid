# QM Raid demo: narration script v3, 1:50 cut (raid-video-vo)

Structure (docs/lanes/video.md, Update 16:08; raid-video sections): hero 0 to 2 (gameplay, no VO), intro 2 to 13, orders 13 to 35, teams 35 to 55, forge 55 to 75, autopilot 75 to 92, loadout 92 to 104, end 104 to 110. Clip title cards are 1.0 s; the herald starts after them. Each line carries the capture event it anchors to.

Voices: ElevenLabs eleven_v3 stock voices, Harry (hype anime announcer) for the intro, George (warm British herald) after it. Kokoro-82M (tts.py) is the local fallback. Durations are measured on the delivered wavs (silence trimmed, -16 LUFS).

Words: 180 spoken, 80 s of speech in 110 s; every clip keeps at least 4 s without narration.

## Intro (hype announcer, ElevenLabs Harry; beats from raid-video-intro) 0:02 to 0:13 (11 s slot, 10.0 s speech, 23 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_intro_1 |  | 2.1 | 2.02 | Your issues are monsters! |
| vo_intro_2 |  | 4.3 | 2.05 | Your AI agents are units! |
| vo_intro_3 |  | 6.45 | 1.94 | GBrain is their shared memory! |
| vo_intro_4 |  | 8.65 | 2.12 | River forges new unit types! |
| vo_intro_5 |  | 10.9 | 1.9 | This is QM RAID! |

## Clip 1 Orders and memory 0:13 to 0:35 (22 s slot, 15.7 s speech, 40 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_orders_1 | select | 14.3 | 5.36 | Hear ye, hear ye! Order a knight, a real QM agent, to a camp. |
| vo_orders_2 | recall_beam | 21.86 | 6.91 | Blue beam: first it checks the Library, our GBrain. Then it works the issue. For real. |
| vo_orders_3 | remember_orb | 30.97 | 3.43 | Gold orb: what it learned goes back on the shelf. |
| vo_orders_qm (alt) | qm_cut (only if the QM view shows the GBrain tool calls) | 13 | 7.36 | Inside QM, the same knight: the order, its GBrain tool calls, the reply. |

## Clip 2 Teams 0:35 to 0:55 (20 s slot, 15.5 s speech, 32 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_teams_1 | select3 | 36.3 | 5.94 | Three units? That's a team. Form the Trio: planner, implementer, reviewer. |
| vo_teams_2 | handoff | 43.52 | 6.47 | Right-click a camp, and the scrolls fly. The reviewer checks the work against the house rules. |
| vo_teams_3 | verdict | 51.28 | 3.12 | Verdict: approved! The camp falls. |
| vo_teams_2b (alt) | handoff | 43.52 | 6.82 | Right-click a camp, and the scrolls fly. The reviewer is a Rule Warden, forged by River. |
| vo_teams_3b (alt) | verdict | 51.28 | 4.52 | Verdict: changes! Back to the anvil, implementer. |
| vo_teams_qm (alt) | qm_cut | 35 | 4.78 | Same trio, inside QM: every handoff is a real conversation. |

## Clip 3 The Forge (River AI) 0:55 to 1:15 (20 s slot, 14.2 s speech, 34 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_forge_1 | forge_open | 56.3 | 6.4 | Need a unit nobody has? To the Forge! River fine-tunes a model on practice orders. |
| vo_forge_2 | card | 64.66 | 5.8 | Refund Ranger, Rule Warden: each beats its base model on held-out test orders. |
| vo_forge_3 | train | 72.43 | 1.97 | Train one, and out it walks! |

## Clip 4 Autopilot and new issues 1:15 to 1:32 (17 s slot, 11.7 s speech, 27 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_auto_1 | new_issue | 76.3 | 3.1 | A new issue? A fresh camp appears on the map. |
| vo_auto_2 | proposed | 82.84 | 8.56 | Autopilot proposes orders, each with a fifteen second veto ring. Object now, or forever hold your peace. |
| vo_auto_3 (alt) | veto, only if a cancel is on screen | 75 | 4.43 | Don't like one? Cancel it. Like one? Let it ride. |

## Clip 5 Loadout (mock close-up) 1:32 to 1:44 (12 s slot, 8.7 s speech, 17 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_loadout_1 | loadout_open | 93.3 | 4.74 | Every knight carries a loadout: standing orders, skills, and plugins. |
| vo_loadout_2 | save | 99.47 | 3.93 | Rewrite its standing orders right here, mid-battle. |

## End card 1:44 to 1:50 (6 s slot, 4.2 s speech, 7 words)
| id | anchor | at (s) | dur (s) | line |
|---|---|---|---|---|
| vo_end |  | 104.3 | 4.19 | One human. Thirty-one AI agents. Built today. |
| vo_end_b (alt) |  | 104 | 3.6 | One human, a swarm of AI agents, built today. |

Alts: `vo_teams_2b` names the Rule Warden (use only if the take shows it reviewing); `vo_teams_3b` if the verdict is CHANGES; `vo_auto_3` only if a cancel is on screen; `vo_orders_qm` and `vo_teams_qm` for the QM web UI intercuts, only if the QM view shows what they say (the order, GBrain tool calls, the reply; the teammates' conversations). If an intercut line is used, shorten or drop the neighbouring line so the clip still breathes. `vo_end_b` has no number.

## Evidence for claims (for raid-video-rev)
- "a real QM agent": knight = QM agent on gpt-6-astra (docs/CONTRACT.md class map); the take runs on the real engine 4610 with real QM.
- "first it checks the Library, our GBrain" / "what it learned goes back on the shelf": blue recall beam and gold remember orb (README, COMMON.md).
- "the reviewer checks the work against the house rules": default reviewer instructions in docs/CONTRACT.md.
- "River fine-tunes a model on practice orders": the Forge generates synthetic orders and trains through River (river/runs/forge-refund-ranger-2/model.json, River checkpoint on Qwen/Qwen3.5-9B).
- "each beats its base model on held-out test orders": Refund Ranger 0.82 vs 0.42, Rule Warden 0.917 vs 0.557 on held-out orders (new phrasings of known synthetic issues); numbers only on the cards.
- "fifteen second veto ring ... object now, or forever hold your peace": services/engine/src/config.ts:22 `VETO_WINDOW_MS = 15000`; an unvetoed proposal goes ahead when the window ends.
- "Every knight carries a loadout: standing orders, skills, and plugins" / "rewrite its standing orders right here": docs/CONTRACT.md Loadout, shown on the mock close-up; no claim about the next order.
- "Thirty-one AI agents": herdr agent list at 15:47, 30 raid-* agents plus the Analyst; raid-video-rev counted independently.

## Sound (all original, generated for this video)
- ElevenLabs sound effects on raid-video-intro's hit times (smash cut 2.00, unit lands 4.47/4.70/4.93, beam 6.63, orb 7.90, hammers 8.87/9.20/9.53, clash 11.20, logo slam 11.27, wipe 12.60), a whoosh on each clip card (13, 35, 55, 75, 92) and a chime on the end card (104). SFX at -20 LUFS. Extras: sfx_scroll, sfx_hammer, sfx_chime, sfx_beam, sfx_orb.
- ElevenLabs instrumental music: `music.wav` 110 s = the anime opener from frame 0 (its final hit on the title drop), then a quiet medieval march bed at -30 LUFS from 12.5 s, fading out at the end.

Files: `video/audio/<id>.wav` (gitignored, = line ids), `video/audio/manifest.json`. Regenerate: `python3 video/audio/eleven.py` then `python3 video/audio/manifest.py`. Fallback: `tts.py` then `manifest.py kokoro`.
