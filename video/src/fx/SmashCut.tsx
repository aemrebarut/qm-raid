// Smash cut from gameplay into the anime intro: 2 frames of inverted ink with black focus lines, then a
// white impact flash. Place it so the hard cut happens at local frame 2 (for example at 1.933 s for a cut at 2.0 s).
import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { FocusLines } from "./primitives";
import { useLocal } from "./theme";

export const SMASH_FRAMES = 6;

export const SmashCut: React.FC<{ from?: number; x?: number; y?: number }> = ({ from = 0, x = 960, y = 540 }) => {
  const f = useLocal(from, SMASH_FRAMES);
  if (f === null) return null;
  if (f < 2)
    return (
      <AbsoluteFill style={{ pointerEvents: "none", backdropFilter: "invert(1) grayscale(1) contrast(2.2)" }}>
        <FocusLines f={f} cx={x} cy={y} inner={220} count={90} color="#000000" opacity={0.9} />
      </AbsoluteFill>
    );
  return <AbsoluteFill style={{ pointerEvents: "none", background: "#fff8e6", opacity: interpolate(f, [2, SMASH_FRAMES], [1, 0]) }} />;
};
