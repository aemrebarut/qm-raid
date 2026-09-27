# Intro storyboard (raid-video-intro)

15 s anime-style opener, fully code-drawn in Remotion (SVG and CSS, no images, no copyrighted characters, music or sound).
Composition `Intro`: 1920x1080, 30 fps, 450 frames. Component: `import {Intro} from "./intro/Intro"` (named export), also `INTRO_FRAMES = 450`.

## The four plain claims (each gets one beat, one title card, one VO line)
1. Your issues are monsters.
2. Your AI agents are units.
3. GBrain is their shared memory.
4. River forges new unit types.

## Beats (frame ranges at 30 fps)
| # | Time | Frames | Picture | Title card | VO (announcer, hype) |
|---|------|--------|---------|------------|----------------------|
| 1 | 0.0 to 2.8 | 0 to 84 | Black, a 2 frame white flash, horizontal speed lines. A horde of slime monsters (red, green, violet) bounces toward camera, each carrying an issue tag from our synthetic Lumen backlog ("Refund webhook retries issue duplicate refunds", "OIDC login loops..."). Screen shake on every landing. Tiny chibi scout pops in lower right with a sweat drop. | YOUR ISSUES / ARE MONSTERS! | "Your backlog is attacking! Your issues are monsters!" |
| 2 | 2.8 to 6.0 | 84 to 180 | Impact frame (3 frames, inverted ink on white), then a gold radial burst with rotating speed lines. Chibi squad slams in one by one: Ada (knight), Bram (ranger), Cato (scout), each with a slanted name card (name, class, model). | YOUR AI AGENTS / ARE UNITS! | "Your AI agents are units!" |
| 3 | 6.0 to 9.0 | 180 to 270 | The Library (stone monastery, blue window, crest). Ada raises the staff: blue recall beam from the Library with rising glyph sparks; then a gold orb arcs back into the Library, it pulses, "+1 PAGE" pops. | GBRAIN IS THEIR / SHARED MEMORY | "GBrain is their shared memory!" |
| 4 | 9.0 to 12.0 | 270 to 360 | The Forge (smithy, River-blue furnace glow). Hammer strikes on the anvil x3 with white impact flashes and spark bursts; a new unit steps out glowing River-blue with runes: "REFUND RANGER". | RIVER FORGES / NEW UNIT TYPES! | "And River forges new unit types!" |
| 5 | 12.0 to 15.0 | 360 to 450 | Dramatic push-in: squad charges from the left, the horde from the right, clash at 12.5 s with a big impact frame and shake. Logo slam "QM RAID" in gold on a stone plate, sparkles, subtitle "An RTS board for your AI agent swarm". Last 10 frames: speed-line wipe to white for the editor's cut. | QM RAID | "This is... QM RAID!" |

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
