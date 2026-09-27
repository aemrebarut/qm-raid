// Punch-in zoom: wrap the clip (OffthreadVideo) in <PunchIn>; from `from` it slams into (x, y) with a flash,
// shake and focus lines, holds, then eases back out. Outside its window the child is untouched.
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import { FocusLines, ImpactFlash, shake } from "./primitives";
import { usePop } from "./theme";

export type PunchInProps = {
  from: number; // frame the zoom starts, in the parent's timeline
  duration?: number; // total frames including the ease out (default 45)
  x: number; // focus point in 1920x1080 pixels
  y: number;
  scale?: number; // zoom factor at the hold (default 1.6)
  lines?: boolean; // anime focus lines during the hold (default true)
  children: React.ReactNode;
};

export const PunchIn: React.FC<PunchInProps> = ({ from, duration = 45, x, y, scale = 1.6, lines = true, children }) => {
  const f = useCurrentFrame() - from;
  const active = f >= 0 && f < duration;
  const pop = usePop(active ? f : 0, 0, 13, 260);
  const out = interpolate(f, [duration - 10, duration], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const k = active ? 1 + (scale - 1) * pop * out : 1;
  const s = active ? shake(f - 2, 14, 8) : { x: 0, y: 0 };
  // Keep the focus point where it is on screen, but pull it a little toward center so the subject reads.
  const tx = active ? (960 - x) * 0.35 * pop * out : 0;
  const ty = active ? (540 - y) * 0.35 * pop * out : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${tx + s.x}px, ${ty + s.y}px) scale(${k})`, transformOrigin: `${x}px ${y}px` }}>
        {children}
      </AbsoluteFill>
      {active && lines && f < duration - 10 ? (
        <FocusLines f={f} cx={960 + (x - 960) * (1 - 0.35 * pop)} cy={540 + (y - 540) * (1 - 0.35 * pop)} inner={330} opacity={0.55 * Math.min(1, f / 3)} />
      ) : null}
      {active ? <ImpactFlash f={f} frames={3} strength={0.55} /> : null}
    </AbsoluteFill>
  );
};
