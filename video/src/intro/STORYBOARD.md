# Intro storyboard (raid-video-intro)

11 s anime-style opener, fully code-drawn in Remotion (SVG and CSS, no images, no copyrighted characters, music or sound).
It plays at video 0:02 to 0:13, right after the editor's 2 s real gameplay hero shot (Emre 16:03), and opens on a smash cut.
Composition `Intro`: 1920x1080, 30 fps, 330 frames. Component: `import {Intro} from "./intro/Intro"` (named export), also `INTRO_FRAMES = 330`.

## The four plain claims (each gets one beat, one title card, one VO line)
1. Your issues are monsters.
2. Your AI agents are units.
3. GBrain is their shared memory.
4. River forges new unit types.

## Beats (intro frames at 30 fps; video time = 2.0 s + intro time)
| # | Intro frames | Video time | Picture | Title card | VO (announcer, hype) |
|---|--------------|------------|---------|------------|----------------------|
| 1 | 0 to 66 | 2.0 to 4.2 | Smash cut: 3 frame ink-on-white impact frame with a red burst and "!!". A horde of slime monsters bounces in, each front slime carrying an issue tag from our synthetic Lumen backlog. Chibi scout panics lower right with a sweat drop and "!?". | YOUR ISSUES / ARE MONSTERS! | "Your issues are monsters!" (2.1) |
| 2 | 66 to 132 | 4.2 to 6.4 | Impact frame, gold radial burst. Ada (knight), Bram (ranger), Cato (scout) slam in with name cards (name, class, model). Eye-glint close-up on Ada (letterboxed), then the title. | YOUR AI AGENTS / ARE UNITS! | "Your AI agents are units!" (4.3) |
| 3 | 132 to 198 | 6.4 to 8.6 | The GBrain Library. Ada raises the staff: blue RECALL beam from the Library; a gold REMEMBER orb arcs back, the Library pulses, "+1 PAGE" pops. | GBRAIN IS THEIR / SHARED MEMORY | "GBrain is their shared memory!" (6.45) |
| 4 | 198 to 264 | 8.6 to 10.8 | The Forge (River). Three hammer strikes with flashes and sparks; a River-blue pillar and the REFUND RANGER steps out ("new unit type, trained with River"). | RIVER FORGES / NEW UNIT TYPES! | "River forges new unit types!" (8.65) |
| 5 | 264 to 330 | 10.8 to 13.0 | Squad charges, horde charges, clash with impact frame and shake; slimes fly off KO; logo slam "QM RAID" on a stone plate, subtitle "An RTS board for your AI agent swarm". Last 12 frames: speed-line wipe to white. | QM RAID | "This is QM RAID!" (10.9) |

Hits (video time): smash 2.00; title slams 2.40, 2.73; units land 4.47, 4.70, 4.93; glint 4.93; title slams 5.23, 5.50; recall beam 6.63; orb lands 7.90; hammer 8.87, 9.20, 9.53; new unit 9.77; clash 11.20; logo 11.27; subtitle 11.60; wipe 12.60 to 13.00.

## Art direction (shared with raid-video-fx so the whole video reads as one style)
- Palette (from the board, apps/board/src/theme/tokens.css): gold `#d9a441` (hi `#f3c969`), bronze metal `#8c7a5a` / lo `#3b3326` / hi `#c8ad7a`, parchment ink `#ece6d8`, stone dark `#1b1712` / `#2a241c`, recall blue `#6fa8ff`, River blue `#4fa7e0`, remember gold `#e0b454`, ok green `#7cc47f`, danger red `#d65a45`, team red `#d64545`, team blue `#3f7fd6`, violet `#b08ce8`, outline warm brown `#24170d` (the game's unit outline).
- Type: titles in "Avenir Next Condensed" weight 800 to 900 (fallback "DIN Condensed", Impact), ALL CAPS, slight italic skew (-8 deg), thick outline via layered text-shadow or SVG stroke (warm brown `#24170d`, 10 to 14 px), gold gradient fill, a hard drop shadow offset 8 px. Body and small labels: -apple-system, weight 700.
- Anime grammar: speed lines (radial for reveals, horizontal for motion), impact frames (2 to 3 frames of inverted ink on white or white flash), screen shake (decaying, 6 to 10 frames, 20 px max), squash and stretch on slams (overshoot spring), sparkle stars (4 point), halftone dot backgrounds, big slanted title cards.
- Characters: chibi (head about 45 percent of height), thick warm-brown outline, flat cel shading with one shadow tone. Knight: helmet with plume, shield, staff. Ranger: hood, bow-staff. Scout: light cloak, big eyes. Forged River units: glowing runes in River blue. Monsters: round slimes with angry eyes and a tag.
- Motion: snappy. Ease with springs (damping 12 to 14, high stiffness), hold key poses 6 to 10 frames, never linear fades longer than 8 frames.

## Fun beats
- Chibi scout with a sweat drop facing a horde that is much bigger than the scout.
- Name cards with the model: "ADA / KNIGHT / gpt-6-astra".
- "+1 PAGE" pop when the orb lands.
- Forge hammer: three strikes, three flashes, then the new unit strikes a pose.

## Honesty check
Every claim is a claim the game makes true on screen in the clips: issues are camps of monsters on the map, agents are real QM agents shown as units, the Library is GBrain (recall beam and remember orb), the Forge trains new unit types with River. No numbers beyond "+1 PAGE".
