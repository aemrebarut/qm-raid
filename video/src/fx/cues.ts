// The cue registry (CUES) and punchTransform; index.ts re-exports these.
// raid-video places these at capture markers via FxCue in ../timeline.ts:
//   overlays: <Sequence from={at * FPS} durationInFrames={CUES[kind].frames}><CUES[kind].C text x y /></Sequence>
//   punch-ins: style={{ transform: punchTransform(frame, fps, cues) }} on the video layer, plus the "punchIn"
//   overlay cue at the same time for the focus lines and flash.
import React from "react";
import { spring } from "remotion";
import type { FxCue } from "../timeline";
import { Callout } from "./Callout";
import { Combo } from "./Combo";
import { ForgedBurst } from "./ForgedBurst";
import { Mascot, Mood } from "./Mascot";
import { PlusPop } from "./PlusPop";
import { FocusLines, ImpactFlash, shake } from "./primitives";
import { ScoreRace } from "./ScoreRace";
import { SpeedWipe } from "./SpeedWipe";
import { Stamp } from "./Stamp";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { FxColor } from "./theme";


type CueProps = { text?: string; x?: number; y?: number };
type Cue = { frames: number; C: React.FC<CueProps>; note: string };

const PUNCH_FRAMES = 45;
const PUNCH_SCALE = 1.6;

const callout = (tone: FxColor, fallback: string): React.FC<CueProps> => ({ text, x = 960, y = 540 }) => {
  const [label, sub] = (text ?? fallback).split("|");
  const side = x > 1280 ? "left" : y > 820 ? "top" : "right";
  return React.createElement(Callout, { from: 0, duration: 60, x, y, label, sub, side, tone });
};

// "7 ORDERS", "12480 TOKENS": first number is the count, the rest is the label.
const combo = (fallback: string): React.FC<CueProps> => ({ text, x, y }) => {
  const m = /^\s*([\d,]+)\s*(.*)$/.exec(text ?? fallback) ?? [];
  const value = Number((m[1] ?? "0").replace(/,/g, ""));
  return React.createElement(Combo, { from: 0, duration: 60, value, label: (m[2] || "COMBO").toUpperCase(), x, y });
};

const mascot = (mood: Mood): React.FC<CueProps> => ({ text, x }) =>
  React.createElement(Mascot, { from: 0, duration: 60, mood, say: text, corner: x !== undefined && x > 960 ? "br" : "bl" });

// Focus lines and a flash over the zoomed video; pairs with punchTransform on the video layer.
const PunchOverlay: React.FC<CueProps> = ({ x = 960, y = 540 }) => {
  const f = useCurrentFrame();
  if (f >= PUNCH_FRAMES - 10) return null;
  return React.createElement(
    AbsoluteFill,
    { style: { pointerEvents: "none" } },
    React.createElement(FocusLines, { f, cx: 960 + (x - 960) * 0.65, cy: 540 + (y - 540) * 0.65, inner: 330, opacity: 0.5 * Math.min(1, f / 3) }),
    React.createElement(ImpactFlash, { f, frames: 3, strength: 0.55 }),
  );
};

export const CUES: Record<string, Cue> = {
  punchIn: { frames: PUNCH_FRAMES, C: PunchOverlay, note: "x,y focus; also drives punchTransform" },
  callout: { frames: 60, C: callout("gold", "LOOK!"), note: "gold ring+arrow; text 'LABEL|small line'" },
  calloutRecall: { frames: 60, C: callout("recall", "RECALL"), note: "blue, for the recall beam" },
  calloutRiver: { frames: 60, C: callout("river", "THE FORGE"), note: "River blue, Forge card" },
  pagePop: { frames: 40, C: ({ text, x = 960, y = 540 }) => React.createElement(PlusPop, { from: 0, x, y, text: text ?? "+1 page" }), note: "memory landed" },
  approvedStamp: { frames: 60, C: ({ text, x, y }) => React.createElement(Stamp, { from: 0, text: text ?? "APPROVED!", x, y }), note: "reviewer verdict" },
  forgedBurst: { frames: 75, C: ({ text, x, y }) => React.createElement(ForgedBurst, { from: 0, name: text, x, y }), note: "text = unit name" },
  scoreRace: { frames: 90, C: ({ x, y }) => React.createElement(ScoreRace, { from: 0, x, y }), note: "trained 0.82 vs base 0.42; x,y top-left" },
  comboOrders: { frames: 60, C: combo("3 ORDERS"), note: "text '7 ORDERS'; x,y right edge/top" },
  comboTokens: { frames: 60, C: combo("12480 TOKENS"), note: "text '12480 TOKENS'" },
  mascot: { frames: 60, C: mascot("cheer"), note: "cheer; text = bubble; x>960 puts it bottom right" },
  mascotCheer: { frames: 60, C: mascot("cheer"), note: "" },
  mascotShock: { frames: 60, C: mascot("shock"), note: "" },
  mascotSmug: { frames: 60, C: mascot("smug"), note: "" },
  mascotThink: { frames: 60, C: mascot("think"), note: "" },
  speedWipe: { frames: 16, C: ({ text }) => React.createElement(SpeedWipe, { from: 0, label: text }), note: "fully covers at frame 8: cut there" },
};

// CSS transform for the 1920x1080 video layer (default transform-origin): combines every punchIn cue active at
// `frame` (clip-local frames, cue.at in seconds).
export function punchTransform(frame: number, fps: number, cues: FxCue[]): string {
  let tx = 0, ty = 0, k = 1;
  for (const c of cues) {
    if (c.kind !== "punchIn") continue;
    const f = frame - Math.round(c.at * fps);
    if (f < 0 || f >= PUNCH_FRAMES) continue;
    const x = c.x ?? 960, y = c.y ?? 540;
    const pop = spring({ frame: f, fps, config: { damping: 13, stiffness: 260, mass: 0.7 } });
    const out = f < PUNCH_FRAMES - 10 ? 1 : 1 - (f - (PUNCH_FRAMES - 10)) / 10;
    const ease = out * out * (3 - 2 * out);
    const s = shake(f - 2, 14, 8);
    const kk = 1 + (PUNCH_SCALE - 1) * pop * ease;
    // Scale about (x, y), pull the subject 35 percent toward center, add the hit shake.
    const px = (960 - x) * 0.35 * pop * ease, py = (540 - y) * 0.35 * pop * ease;
    // The layer keeps its default transform-origin (center of a 1920x1080 layer).
    tx += px + s.x + (x - 960) * (1 - kk);
    ty += py + s.y + (y - 540) * (1 - kk);
    k *= kk;
  }
  return k === 1 && tx === 0 && ty === 0 ? "none" : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(4)})`;
}
