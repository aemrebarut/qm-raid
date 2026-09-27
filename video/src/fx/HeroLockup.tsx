// "QM Raid" lockup for the 2 s hero shot that opens the video. Fully drawn at local frame 0 (no pop-in, no fade)
// so frame 0 works as the thumbnail; only a gleam sweeps across it afterwards.
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { Sparkle } from "./primitives";
import { FX, HEAD, goldText, plate, useLocal } from "./theme";

export type HeroLockupProps = { from?: number; duration?: number; sub?: string; x?: number; y?: number };

export const HeroLockup: React.FC<HeroLockupProps> = ({ from = 0, duration = 60, sub = "An RTS for your AI agents", x = 48, y = 44 }) => {
  const f = useLocal(from, duration);
  if (f === null) return null;
  const gleam = interpolate(f, [8, 26], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const tw = 0.6 + 0.4 * Math.abs(Math.sin(f / 5));
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ ...plate, position: "absolute", left: x, top: y, padding: "14px 30px 16px 26px", transform: "skewX(-8deg)", overflow: "hidden", borderColor: FX.gold }}>
        <div style={{ transform: "skewX(8deg)" }}>
          <span style={{ ...goldText("gold", 96), transform: "skewX(-8deg)" }}>QM Raid</span>
          <div style={{ fontFamily: HEAD, fontWeight: 800, fontSize: 30, letterSpacing: "0.12em", textTransform: "uppercase", color: FX.ink, marginTop: 6, textShadow: `0 2px 0 ${FX.outline}` }}>
            {sub}
          </div>
        </div>
        <div
          style={{
            position: "absolute", top: -20, bottom: -20, left: `${gleam}%`, width: 70,
            background: "linear-gradient(90deg, rgba(255,243,214,0), rgba(255,243,214,.35), rgba(255,243,214,0))", transform: "skewX(-20deg)",
          }}
        />
      </div>
      <Sparkle x={x + 360} y={y + 18} size={40} rotate={f * 4} opacity={tw} />
      <Sparkle x={x + 22} y={y + 112} size={26} rotate={-f * 5} opacity={1.4 - tw} />
    </AbsoluteFill>
  );
};
