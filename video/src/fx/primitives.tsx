// Small anime building blocks reused by the overlays: 4 point sparkles, radial focus lines, impact flash.
import React from "react";
import { AbsoluteFill, interpolate, random } from "remotion";
import { FX } from "./theme";

export const Sparkle: React.FC<{ x: number; y: number; size: number; color?: string; rotate?: number; opacity?: number }> = ({
  x, y, size, color = FX.goldHi, rotate = 0, opacity = 1,
}) => (
  <svg
    width={size} height={size} viewBox="-10 -10 20 20"
    style={{ position: "absolute", left: x - size / 2, top: y - size / 2, transform: `rotate(${rotate}deg)`, opacity, overflow: "visible" }}
  >
    <path d="M0 -10 Q1.2 -1.2 10 0 Q1.2 1.2 0 10 Q-1.2 1.2 -10 0 Q-1.2 -1.2 0 -10 Z" fill={color} stroke={FX.outline} strokeWidth={0.9} />
  </svg>
);

// Sparkles flying out from (x, y); f is the local frame, life in frames.
export const SparkleBurst: React.FC<{ f: number; x: number; y: number; count?: number; radius?: number; life?: number; seed?: string; colors?: string[] }> = ({
  f, x, y, count = 10, radius = 220, life = 24, seed = "s", colors = [FX.goldHi, "#ffffff", FX.gold],
}) => {
  if (f < 0 || f > life) return null;
  const p = f / life;
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + random(`${seed}a${i}`) * 0.6;
        const d = radius * (0.55 + random(`${seed}d${i}`) * 0.45) * (1 - Math.pow(1 - p, 3));
        const s = (22 + random(`${seed}s${i}`) * 30) * (1 - p * 0.8);
        return <Sparkle key={i} x={x + Math.cos(a) * d} y={y + Math.sin(a) * d} size={s} color={colors[i % colors.length]} rotate={f * 12 + i * 20} opacity={1 - p * p} />;
      })}
    </>
  );
};

// Radial anime focus lines (shuchusen) that leave a clear hole around (cx, cy). Redrawn on twos.
export const FocusLines: React.FC<{ f: number; cx?: number; cy?: number; inner?: number; count?: number; color?: string; opacity?: number }> = ({
  f, cx = 960, cy = 540, inner = 300, count = 70, color = "#ffffff", opacity = 0.85,
}) => {
  const t = Math.floor(f / 2);
  const R = 2400;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <svg width={1920} height={1080} viewBox="0 0 1920 1080">
        {Array.from({ length: count }, (_, i) => {
          const a = (i / count) * Math.PI * 2 + random(`fl${t}-${i}`) * 0.08;
          const w = 0.006 + random(`fw${t}-${i}`) * 0.018;
          const r0 = inner * (0.9 + random(`fr${t}-${i}`) * 0.6);
          const pts = [
            [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0],
            [cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R],
            [cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R],
          ];
          return <polygon key={i} points={pts.map((p) => p.join(",")).join(" ")} fill={color} />;
        })}
      </svg>
    </AbsoluteFill>
  );
};

// White impact flash for the first `frames` local frames (2 to 3 per the art direction).
export const ImpactFlash: React.FC<{ f: number; frames?: number; color?: string; strength?: number }> = ({ f, frames = 3, color = "#fff8e6", strength = 0.75 }) => {
  if (f < 0 || f >= frames) return null;
  return <AbsoluteFill style={{ background: color, opacity: interpolate(f, [0, frames], [strength, 0]), mixBlendMode: "screen" }} />;
};

// Decaying screen shake offset for a hit at local frame 0.
export function shake(f: number, amp = 20, frames = 9): { x: number; y: number } {
  if (f < 0 || f >= frames) return { x: 0, y: 0 };
  const k = amp * (1 - f / frames);
  return { x: (random(`shx${f}`) * 2 - 1) * k, y: (random(`shy${f}`) * 2 - 1) * k };
}
