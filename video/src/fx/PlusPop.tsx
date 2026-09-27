// "+1 page" pop: springs up from (x, y) when a memory lands in GBrain, floats and fades, with sparkles.
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { SparkleBurst } from "./primitives";
import { FxColor, fadeOut, goldText, useLocal, usePop } from "./theme";

export type PlusPopProps = { from: number; x: number; y: number; text?: string; duration?: number; size?: number; tone?: FxColor };

export const PlusPop: React.FC<PlusPopProps> = ({ from, x, y, text = "+1 page", duration = 40, size = 72, tone = "gold" }) => {
  const f = useLocal(from, duration);
  const pop = usePop(f ?? 0, 0, 8, 240);
  if (f === null) return null;
  const rise = interpolate(f, [0, duration], [0, -110], { easing: (t) => 1 - Math.pow(1 - t, 2) });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <SparkleBurst f={f} x={x} y={y} count={8} radius={120} life={18} seed={`pp${from}`} />
      <div style={{ position: "absolute", left: x, top: y + rise, transform: `translate(-50%, -50%) scale(${pop})`, opacity: fadeOut(f, duration, 10) }}>
        <span style={goldText(tone, size)}>{text}</span>
      </div>
    </AbsoluteFill>
  );
};
