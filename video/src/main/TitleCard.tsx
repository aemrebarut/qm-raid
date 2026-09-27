import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

// Gold-on-stone banner that slams in over the first second of a clip.
export const TitleCard: React.FC<{ index: number; title: string; subtitle: string; frames: number }> = ({ index, title, subtitle, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame: f, fps, config: { damping: 12, stiffness: 180 } });
  const out = interpolate(f, [frames - 8, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <div
        style={{
          transform: `scale(${interpolate(inS, [0, 1], [1.6, 1])}) rotate(${interpolate(inS, [0, 1], [-4, 0])}deg)`,
          background: `linear-gradient(180deg, #2a3038 0%, ${theme.slate} 100%)`,
          border: `6px solid ${theme.gold}`,
          boxShadow: `0 0 0 3px ${theme.night}, 0 20px 60px rgba(0,0,0,0.6)`,
          borderRadius: 14,
          padding: "28px 72px",
          textAlign: "center",
        }}
      >
        <div style={{ color: theme.sand, fontFamily: theme.bodyFont, fontSize: 30, letterSpacing: 8, fontWeight: 700 }}>
          CAPABILITY {index}
        </div>
        <div style={{ color: theme.goldHi, fontFamily: theme.titleFont, fontSize: 104, fontWeight: 900, textShadow: `0 4px 0 ${theme.night}` }}>
          {title}
        </div>
        <div style={{ color: theme.parchment, fontFamily: theme.bodyFont, fontSize: 36, marginTop: 6 }}>{subtitle}</div>
      </div>
    </AbsoluteFill>
  );
};
