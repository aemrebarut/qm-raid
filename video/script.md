# QM Raid demo: narration script v1 (raid-video-vo)

Target 1:49 (intro 15 s, five clips 90 s, end card 4 s). Slots from raid-video (36ece61): intro 0 to 15, orders 15 to 35, teams 35 to 55, forge 55 to 75, autopilot 75 to 90, loadout 90 to 105, end 105 to 109. Each clip opens with a 1.2 s title card; the herald starts after it.

Voices (local Kokoro-82M, no API keys; fallback macOS `say -v Daniel`):
- Intro: hype announcer, `am_puck`, fast and bright.
- Clips and end card: medieval herald, `bm_george`, brisk.

Pace: about 2.6 words per second, never more than 80 percent of a slot filled, so the picture breathes. One wav per beat so the editor can slide each line onto the capture markers.

## Intro 0:00 to 0:15 (hype announcer; beats and title cards from video/src/intro/STORYBOARD.md)
| id | at (s) | line | words |
|---|---|---|---|
| vo_intro_1 | 0.0 | Your backlog is attacking! Your issues are monsters! | 8 |
| vo_intro_2 | 2.8 | Your AI agents are units! | 5 |
| vo_intro_3 | 6.0 | GBrain is their shared memory! | 5 |
| vo_intro_4 | 9.0 | And River forges new unit types! | 6 |
| vo_intro_5 | 12.3 | This is... QM RAID! | 4 |

SFX (absolute): impact 0.1, whoosh 2.7, impact 2.8, whoosh 5.9, whoosh 8.9, hammer 9.4, 9.9, 10.4, sparkle 10.6, riser 10.6 to 12.5, impact 12.5, logo slam 12.6, sparkle 12.9. Intro drums under the whole 15 s.

## Clip 1 Orders and memory 0:15 to 0:35 (herald)
| id | marker (capture) | line | words |
|---|---|---|---|
| vo_orders_1 | unit selected, order given | Hear ye! Pick a knight, a real QM agent, and point it at a camp. Off it marches. | 17 |
| vo_orders_2 | recall beam | Blue beam: it recalls from the Library, our GBrain. | 8 |
| vo_orders_3 | QM reply arrives | It works the issue for real. | 6 |
| vo_orders_4 | remember orb, page count up | Gold orb: what it learned goes back. One more page for the whole army. | 14 |

## Clip 2 Teams 0:35 to 0:55
| id | marker | line | words |
|---|---|---|---|
| vo_teams_1 | three selected, Form team, Trio | Three units? Make them a team. Pick the Trio: planner, implementer, reviewer. | 12 |
| vo_teams_2 | order on camp, first handoff | Right-click a camp, and the scrolls fly: plan, to fix, to review. | 12 |
| vo_teams_3 | reviewer working | The reviewer checks the house rules, and gives the word: | 10 |
| vo_teams_4 | VERDICT: APPROVED on screen | Verdict: approved! The camp falls. | 5 |
| vo_teams_4b (alt) | only if the take shows CHANGES first | Verdict: changes! Back to the anvil, implementer. | 7 |

## Clip 3 The Forge (River AI) 0:55 to 1:15
| id | marker | line | words |
|---|---|---|---|
| vo_forge_1 | Forge panel, typing the description | Need a new kind of unit? To the Forge! Describe it: a Refund Ranger. | 13 |
| vo_forge_2 | training progress | The Forge writes practice orders, and River fine-tunes a model on them. | 12 |
| vo_forge_3 | trained vs base card | Then it faces the base model, on orders it has never seen. | 12 |
| vo_forge_4 | Train unit, it walks out | Train one, and out it walks, straight to work. | 9 |

No numbers in the VO: the card on screen carries them, so the narration stays true whatever the take shows.

## Clip 4 Autopilot and new issues 1:15 to 1:30
| id | marker | line | words |
|---|---|---|---|
| vo_auto_1 | new issue button, camp spawns | A new issue? A fresh camp appears on the map. | 9 |
| vo_auto_2 | proposals with rings | Autopilot proposes orders, each with a fifteen second veto ring. | 10 |
| vo_auto_3 | one cancelled, one goes | Don't like one? Cancel it. Like one? Let it ride. | 10 |

## Clip 5 Loadout 1:30 to 1:45 (only if shipped and green; otherwise its time goes to clips 1 and 3)
| id | marker | line | words |
|---|---|---|---|
| vo_loadout_1 | Loadout tab open | Every unit carries a loadout: standing orders, skills, and plugins, GBrain among them. | 13 |
| vo_loadout_2 | edit saved, next order | Change them right in the game. The very next order carries them. | 12 |

## End card 1:45 to 1:49
| id | line | words |
|---|---|---|
| vo_end | Built today, by one human and thirty-one AI agents. | 9 |
| vo_end_b (alt) | Built today, by one human and a swarm of AI agents. | 11 |

## Evidence for claims (for raid-video-rev)
- "fifteen second veto ring": `services/engine/src/config.ts:22` `VETO_WINDOW_MS = 15000`; rings per docs/lanes/video.md clip 4.
- "thirty-one AI agents": `herdr agent list` at 15:47 shows 30 `raid-*` agents (qm 3, eng 5, ui 4, gbrain/river/rev 3, art 5, look 4, video 6) plus the Analyst. The lane doc's "24" is stale. If anyone disagrees, use `vo_end_b` (no number).
- "a real QM agent": knight = QM agent on gpt-6-astra (docs/CONTRACT.md class map); takes run on the real engine 4610 with real QM.
- "recalls from the Library, our GBrain" / "gold orb ... one more page": README, COMMON.md (blue recall beam, gold remember orb), lane clip 1 (page count up).
- "the scrolls fly": `apps/board/src/scene/index.ts:276` (workflow handoff scroll).
- "checks the house rules": default reviewer instructions in docs/CONTRACT.md ("Recall the house rules. Review ... End with VERDICT").
- "River fine-tunes a model": `river/runs/forge-refund-ranger-2/model.json` (River checkpoint on Qwen/Qwen3.5-9B, 24 steps). "orders it has never seen": held-out eval in `services/forge/src/server.ts:50`. Numbers only on the card.
- "the very next order carries them": docs/CONTRACT.md Loadout ("Every order header also restates the unit's current instructions").
- "GBrain among them": docs/CONTRACT.md Loadout (plugins are MCP servers or connectors, GBrain is one).

## Sound (ffmpeg synthesis only, original)
- Intro: drum hits, whooshes, impacts, forge hammer clangs, sparkle, riser, logo slam (cue list above).
- Clips: quiet march drum bed at about 100 bpm under all 94 s, ducked under the VO by the editor (bed at about minus 22 dB).
- Title cards: a short whoosh at each clip start (15, 35, 55, 75, 90) and a soft chime on the end card (105).

Files: `video/audio/*.wav` (gitignored), `video/audio/manifest.json` (committed), generators `video/audio/tts.py`, `video/audio/sfx.sh`, `video/audio/lines.json`.
