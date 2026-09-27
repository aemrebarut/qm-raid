// Callout: pulsing ring around (x, y) with an arrow that draws in from a side and a gold-on-stone label.
// Use for the recall beam, the Library, the Forge card, a camp, a unit.
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { FX, FxColor, HEAD, TONE, fadeOut, plate, useLocal, usePop } from "./theme";

export type CalloutProps = {
  from: number;
  duration?: number; // default 60
  x: number;
  y: number;
  r?: number; // ring radius (default 90)
  label: string;
  sub?: string; // optional second line, small
  side?: "left" | "right" | "top" | "bottom"; // where the label sits (default "right")
  tone?: FxColor; // gold (Library, remember), recall (beam), river (Forge), ok, danger, violet
};

export const Callout: React.FC<CalloutProps> = ({ from, duration = 60, x, y, r = 90, label, sub, side = "right", tone = "gold" }) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 0, 12, 220);
  const labelPop = usePop(f ?? 0, 7, 11, 200);
  if (f === null) return null;
  const t = TONE[tone];
  const alpha = fadeOut(f, duration);
  const dir = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }[side];
  const gap = 150; // arrow length
  const ax0 = x + dir[0] * (r + gap), ay0 = y + dir[1] * (r + gap);
  const ax1 = x + dir[0] * (r + 14), ay1 = y + dir[1] * (r + 14);
  const draw = interpolate(f, [3, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const hx = ax0 + (ax1 - ax0) * draw, hy = ay0 + (ay1 - ay0) * draw;
  const ang = Math.atan2(ay1 - ay0, ax1 - ax0);
  const bob = Math.sin(f / 4) * 6 * draw;
  const pulse = (f % 24) / 24;
  const lx = ax0 + dir[0] * 16, ly = ay0 + dir[1] * 16;
  const anchor = {
    right: "translate(0, -50%)", left: "translate(-100%, -50%)", top: "translate(-50%, -100%)", bottom: "translate(-50%, 0)",
  }[side];
  return (
    <AbsoluteFill style={{ opacity: alpha, pointerEvents: "none" }}>
      <svg width={1920} height={1080} style={{ position: "absolute", overflow: "visible" }}>
        <circle cx={x} cy={y} r={r * (1 + pulse * 0.5)} fill="none" stroke={t.hi} strokeWidth={4} opacity={(1 - pulse) * 0.8 * pop} />
        <circle cx={x} cy={y} r={r * pop} fill="none" stroke={FX.outline} strokeWidth={14} />
        <circle cx={x} cy={y} r={r * pop} fill="none" stroke={t.main} strokeWidth={8} strokeDasharray="22 12" transform={`rotate(${f * 3} ${x} ${y})`} />
        {draw > 0 ? (
          <g transform={`translate(${dir[0] * bob}, ${dir[1] * bob})`}>
            <line x1={ax0} y1={ay0} x2={hx} y2={hy} stroke={FX.outline} strokeWidth={18} strokeLinecap="round" />
            <line x1={ax0} y1={ay0} x2={hx} y2={hy} stroke={t.main} strokeWidth={10} strokeLinecap="round" />
            <polygon
              points="0,0 -40,-26 -40,26"
              transform={`translate(${hx}, ${hy}) rotate(${(ang * 180) / Math.PI})`}
              fill={t.main} stroke={FX.outline} strokeWidth={6} strokeLinejoin="round"
            />
          </g>
        ) : null}
      </svg>
      <div
        style={{
          ...plate, position: "absolute", left: lx, top: ly, padding: "12px 22px",
          transform: `${anchor} scale(${labelPop}) rotate(-2deg)`, borderColor: t.main, textAlign: "center",
        }}
      >
        <div style={{ fontFamily: HEAD, fontWeight: 900, fontSize: 44, letterSpacing: "0.06em", textTransform: "uppercase", color: t.hi, whiteSpace: "nowrap", textShadow: `0 3px 0 ${FX.outline}` }}>
          {label}
        </div>
        {sub ? <div style={{ fontFamily: "-apple-system, system-ui, sans-serif", fontWeight: 700, fontSize: 24, color: FX.ink, marginTop: 4, whiteSpace: "nowrap" }}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};
