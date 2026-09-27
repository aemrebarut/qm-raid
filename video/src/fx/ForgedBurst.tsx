// "NEW UNIT FORGED!" burst: spinning River-blue and gold rays, a title slam, the unit name, sparkles.
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { ImpactFlash, SparkleBurst } from "./primitives";
import { FX, HEAD, fadeOut, goldText, useLocal, usePop } from "./theme";

export type ForgedBurstProps = { from: number; title?: string; name?: string; x?: number; y?: number; duration?: number };

export const ForgedBurst: React.FC<ForgedBurstProps> = ({ from, title = "NEW UNIT FORGED!", name, x = 960, y = 470, duration = 75 }) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 2, 9, 200);
  const namePop = usePop(f ?? 0, 12, 11, 200);
  if (f === null) return null;
  const rays = interpolate(f, [0, 8], [0, 1], { extrapolateRight: "clamp" });
  const alpha = fadeOut(f, duration, 8);
  const stops = Array.from({ length: 16 }, (_, i) => {
    const c = i % 2 === 0 ? (i % 4 === 0 ? "rgba(79,167,224,.55)" : "rgba(217,164,65,.5)") : "rgba(0,0,0,0)";
    return `${c} ${(i / 16) * 360}deg ${((i + 1) / 16) * 360}deg`;
  }).join(", ");
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: alpha }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}px ${y}px, rgba(27,23,18,.1) 0, rgba(27,23,18,.6) 70%)`, opacity: rays }} />
      <div
        style={{
          position: "absolute", left: x - 1400, top: y - 1400, width: 2800, height: 2800, borderRadius: "50%",
          background: `conic-gradient(from ${f * 2.2}deg, ${stops})`, opacity: rays,
          transform: `scale(${0.4 + rays * 0.6})`,
          maskImage: "radial-gradient(circle, black 8%, rgba(0,0,0,.7) 30%, transparent 60%)",
          WebkitMaskImage: "radial-gradient(circle, black 8%, rgba(0,0,0,.7) 30%, transparent 60%)",
        }}
      />
      <div style={{ position: "absolute", left: x, top: y, transform: `translate(-50%, -50%) scale(${pop}) rotate(${-3 + Math.sin(f / 6) * 1.2}deg)` }}>
        <span style={goldText("gold", 138)}>{title}</span>
      </div>
      {name ? (
        <div
          style={{
            position: "absolute", left: x, top: y + 125, transform: `translate(-50%, 0) scale(${namePop})`,
            padding: "10px 34px", borderRadius: 999, background: "linear-gradient(180deg, #2a6f9e, #173b56)",
            border: `4px solid ${FX.river}`, boxShadow: `0 0 0 5px ${FX.outline}, 0 0 40px rgba(79,167,224,.7)`,
            fontFamily: HEAD, fontWeight: 900, fontSize: 54, letterSpacing: "0.08em", textTransform: "uppercase",
            color: "#e6f6ff", whiteSpace: "nowrap", textShadow: `0 3px 0 ${FX.outline}`,
          }}
        >
          {name}
        </div>
      ) : null}
      <SparkleBurst f={f - 2} x={x} y={y} count={16} radius={700} life={30} seed="forge" colors={["#c8ecff", FX.goldHi, "#ffffff", FX.river]} />
      <SparkleBurst f={f - 14} x={x} y={y} count={10} radius={480} life={26} seed="forge2" />
      <ImpactFlash f={f - 2} frames={3} color="#e6f6ff" />
    </AbsoluteFill>
  );
};
