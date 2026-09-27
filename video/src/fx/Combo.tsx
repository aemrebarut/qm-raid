// Combo counter: "x7 ORDERS" or "12,480 TOKENS" that counts up with a bump on every step, fighting-game style.
import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { FX, FxColor, HEAD, TONE, fadeOut, goldText, useLocal, usePop } from "./theme";

export type ComboProps = {
  from: number;
  duration?: number; // default 60
  value: number; // final count
  start?: number; // default 0
  label: string; // "ORDERS", "TOKENS", "HANDOFFS"
  countFrames?: number; // frames to count up (default 24)
  prefix?: string; // default "x" for small counts, "" for big ones
  x?: number; // right edge anchor
  y?: number;
  tone?: FxColor;
};

export const Combo: React.FC<ComboProps> = ({ from, duration = 60, value, start = 0, label, countFrames = 24, prefix, x = 1860, y = 170, tone = "gold" }) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 0, 10, 220);
  if (f === null) return null;
  const at = (fr: number) => Math.round(interpolate(fr, [0, countFrames], [start, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.quad) }));
  const n = at(f);
  let last = 0; // frames since the number last changed
  while (last < f && at(f - last - 1) === n) last++;
  const bump = f < countFrames + 2 ? 1 + 0.3 * Math.exp(-last / 2) : 1;
  const pre = prefix ?? (value < 1000 ? "x" : "");
  const t = TONE[tone];
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut(f, duration) }}>
      <div style={{ position: "absolute", right: 1920 - x, top: y, textAlign: "right", transform: `scale(${pop}) rotate(-4deg)`, transformOrigin: "right center" }}>
        <div style={{ display: "inline-block", transform: `scale(${bump})`, transformOrigin: "right bottom" }}>
          <span style={goldText(tone, 120)}>{pre}{n.toLocaleString("en-US")}</span>
        </div>
        <div
          style={{
            marginTop: 6, marginRight: 8, display: "inline-block", transform: "skewX(-8deg)", padding: "4px 16px",
            background: t.main, color: FX.outline, fontFamily: HEAD, fontWeight: 900, fontSize: 36, letterSpacing: "0.14em",
            boxShadow: `0 0 0 4px ${FX.outline}, 0 6px 0 4px ${FX.outline}`,
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
