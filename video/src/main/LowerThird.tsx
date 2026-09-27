import { interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";

export const LowerThird: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const f = useCurrentFrame();
  const x = interpolate(f, [0, 6], [-60, 0], { extrapolateRight: "clamp" });
  const o = interpolate(f, [0, 5, frames - 5, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: 80,
        bottom: 90,
        transform: `translateX(${x}px)`,
        opacity: o,
        background: "rgba(16,21,28,0.88)",
        borderLeft: `8px solid ${theme.gold}`,
        borderRadius: 6,
        padding: "16px 30px",
        color: theme.parchment,
        fontFamily: theme.bodyFont,
        fontSize: 44,
        fontWeight: 700,
        maxWidth: 1400,
      }}
    >
      {text}
    </div>
  );
};
