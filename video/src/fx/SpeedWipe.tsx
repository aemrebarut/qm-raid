// Speed-line wipe between clips, echoing the intro: a stone panel with gold streaks sweeps across and fully
// covers the frame around its midpoint. Cut the underlying clips at from + duration / 2.
import React from "react";
import { AbsoluteFill, interpolate, random } from "remotion";
import { FX, goldText, useLocal } from "./theme";

export type SpeedWipeProps = { from: number; duration?: number; label?: string; direction?: "right" | "left" };

export const SpeedWipe: React.FC<SpeedWipeProps> = ({ from, duration = 16, label, direction = "right" }) => {
  const f = useLocal(from, duration);
  if (f === null) return null;
  const W = 2600; // panel width; covers 1920 while its left edge is in [-680, 0]
  const L = interpolate(f, [0, duration], [-W - 200, 1920 + 200]);
  const flip = direction === "left" ? "scaleX(-1)" : "";
  return (
    <AbsoluteFill style={{ pointerEvents: "none", transform: flip, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", left: L, top: -40, width: W, height: 1160, transform: "skewX(-14deg)",
          background: `repeating-linear-gradient(0deg, ${FX.stone} 0 18px, ${FX.stone2} 18px 22px)`,
          borderLeft: `26px solid ${FX.gold}`, borderRight: `26px solid ${FX.gold}`,
          boxShadow: `inset 12px 0 0 ${FX.outline}, inset -12px 0 0 ${FX.outline}`,
        }}
      />
      {Array.from({ length: 34 }, (_, i) => {
        const yy = random(`swy${i}`) * 1080;
        const len = 300 + random(`swl${i}`) * 700;
        const lead = random(`swe${i}`) > 0.5; // streak at leading or trailing edge
        const off = random(`swo${i}`) * 300;
        const xx = lead ? L + W + 40 + off - len * 0.3 : L - len - off + 200;
        return (
          <div
            key={i}
            style={{
              position: "absolute", left: xx, top: yy, width: len, height: 4 + random(`swh${i}`) * 10, borderRadius: 8,
              background: i % 3 === 0 ? FX.goldHi : i % 3 === 1 ? FX.ink : FX.gold, opacity: 0.85,
            }}
          />
        );
      })}
      {label ? (
        <div style={{ position: "absolute", left: L + W / 2, top: 540, transform: `translate(-50%, -50%) ${flip}` }}>
          <span style={goldText("gold", 120)}>{label}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
