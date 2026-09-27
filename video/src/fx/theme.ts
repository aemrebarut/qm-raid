// Shared look for the fx overlays: the game's gold-on-stone palette (apps/board/src/theme/tokens.css)
// plus a few timing helpers. Every overlay is positioned in pixels of a 1920x1080 frame.
import type { CSSProperties } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const FX = {
  gold: "#d9a441",
  goldHi: "#ffe2a6",
  goldPale: "#fff3d6",
  goldDeep: "#c08f33",
  ink: "#ece6d8",
  stone: "#1b1712",
  stone2: "#2a241c",
  outline: "#24170d",
  stoneMid: "#3b3326",
  slate: "#0e1115",
  brass: "#8c7a5a",
  brassHi: "#c8ad7a",
  recall: "#6fa8ff",
  river: "#4fa7e0",
  danger: "#d65a45",
  ok: "#7cc47f",
  violet: "#b08ce8",
  warn: "#e39a3b",
} as const;

export type FxColor = "gold" | "recall" | "river" | "ok" | "danger" | "violet";
export const TONE: Record<FxColor, { main: string; hi: string; deep: string }> = {
  gold: { main: FX.gold, hi: "#f3c969", deep: FX.goldDeep },
  recall: { main: FX.recall, hi: "#d4e6ff", deep: "#3a6fc4" },
  river: { main: FX.river, hi: "#c8ecff", deep: "#2a6f9e" },
  ok: { main: FX.ok, hi: "#dcf5dd", deep: "#3f8a42" },
  danger: { main: FX.danger, hi: "#f3c2b8", deep: "#8e2e20" },
  violet: { main: FX.violet, hi: "#e8dcff", deep: "#6b4aa8" },
};

export const HEAD = '"Avenir Next Condensed", "DIN Condensed", "Roboto Condensed", "Arial Narrow", sans-serif';
export const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

// Title-card lettering shared with the intro (video/src/intro/STORYBOARD.md, Art direction):
// Avenir Next Condensed 900 caps, -8 deg skew, warm brown outline, gradient fill, hard 8 px drop shadow.
export function goldText(tone: FxColor = "gold", size = 96): CSSProperties {
  const t = TONE[tone];
  const o = Math.max(3, Math.round(size / 11));
  return {
    display: "inline-block",
    fontFamily: HEAD,
    fontWeight: 900,
    fontSize: size,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    lineHeight: 1,
    whiteSpace: "nowrap",
    transform: "skewX(-8deg)",
    backgroundImage: `linear-gradient(180deg, #ffffff 0%, ${t.hi} 32%, ${t.main} 64%, ${t.deep} 100%)`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextStroke: `${o}px ${FX.outline}`,
    paintOrder: "stroke fill",
    filter: `drop-shadow(0 ${Math.round(size / 12)}px 0 ${FX.outline}) drop-shadow(0 0 ${Math.round(size / 5)}px rgba(0,0,0,.5))`,
  };
}

// Stone plate with a brass hairline, like the HUD panels.
export const plate: CSSProperties = {
  background: "linear-gradient(180deg, rgba(28,33,40,.96), rgba(15,18,23,.96))",
  border: `2px solid ${FX.brass}`,
  boxShadow: `inset 0 1px 0 rgba(255,240,210,.12), 0 6px 18px rgba(0,0,0,.55), 0 0 0 2px ${FX.outline}`,
  borderRadius: 10,
  color: FX.ink,
  fontFamily: HEAD,
};

// Frame relative to `from`, or null outside [from, from + duration).
export function useLocal(from = 0, duration = Infinity): number | null {
  const f = useCurrentFrame() - from;
  return f < 0 || f >= duration ? null : f;
}

export function usePop(f: number, delay = 0, damping = 9, stiffness = 170) {
  const { fps } = useVideoConfig();
  return spring({ frame: f - delay, fps, config: { damping, stiffness, mass: 0.7 } });
}

// 1 while visible, fading to 0 over the last `out` frames.
export function fadeOut(f: number, duration: number, out = 8) {
  if (!Number.isFinite(duration)) return 1;
  return interpolate(f, [duration - out, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

// Deterministic jitter that changes every `hold` frames (anime "shake on twos").
export function jitter(f: number, seed: number, amp: number, hold = 2) {
  const k = Math.floor(f / hold) * 97.13 + seed * 13.7;
  return (Math.sin(k) * 43758.5453 % 1) * amp;
}
