// Big stamped verdict ("APPROVED!") that slams down with squash, flash, shake and a dust ring.
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { FocusLines, ImpactFlash, SparkleBurst, shake } from "./primitives";
import { FX, FxColor, HEAD, TONE, fadeOut, useLocal } from "./theme";

export type StampProps = { from: number; text?: string; x?: number; y?: number; duration?: number; tone?: FxColor; size?: number; rotate?: number };

export const Stamp: React.FC<StampProps> = ({ from, text = "APPROVED!", x = 960, y = 540, duration = 60, tone = "ok", size = 170, rotate = -10 }) => {
  const f = useLocal(from, duration);
  if (f === null) return null;
  const t = TONE[tone];
  const hit = 5; // frame the stamp lands
  const drop = interpolate(f, [0, hit], [3.2, 1], { extrapolateRight: "clamp", easing: (v) => v * v });
  const squash = f >= hit ? 1 + 0.18 * Math.exp(-(f - hit) / 2.5) * Math.cos((f - hit) * 1.4) : 1;
  const s = shake(f - hit, 22, 10);
  const ring = interpolate(f - hit, [0, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeOut(f, duration), transform: `translate(${s.x}px, ${s.y}px)` }}>
      {f >= hit && f < hit + 14 ? <FocusLines f={f} cx={x} cy={y} inner={420} opacity={0.6} /> : null}
      {f >= hit ? (
        <div
          style={{
            position: "absolute", left: x, top: y, width: 900 * ring + 200, height: (900 * ring + 200) * 0.45,
            transform: "translate(-50%, -50%)", borderRadius: "50%", border: `10px solid ${t.hi}`, opacity: 1 - ring,
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute", left: x, top: y, opacity: interpolate(f, [0, 2], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${drop * squash}, ${drop / squash})`,
          padding: `${size * 0.12}px ${size * 0.3}px`, border: `${size * 0.07}px solid ${t.main}`, borderRadius: size * 0.12,
          outline: `${size * 0.025}px solid ${t.main}`, outlineOffset: -size * 0.14,
          background: "rgba(27,23,18,.72)", boxShadow: `0 0 0 6px ${FX.outline}, 0 10px 0 6px ${FX.outline}`,
          fontFamily: HEAD, fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: "0.04em", whiteSpace: "nowrap",
          color: t.main, textShadow: `0 6px 0 ${FX.outline}`, WebkitTextStroke: `4px ${FX.outline}`, paintOrder: "stroke fill",
        }}
      >
        {text}
      </div>
      <SparkleBurst f={f - hit} x={x} y={y} count={14} radius={560} life={22} seed="stamp" colors={[t.hi, "#ffffff", FX.goldHi]} />
      <ImpactFlash f={f - hit} frames={3} />
    </AbsoluteFill>
  );
};
