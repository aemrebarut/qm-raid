import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { theme } from "../theme";

export const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14 } });
  const o = (d: number) => interpolate(f, [d, d + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${theme.slate} 0%, ${theme.night} 75%)`, justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div style={{ transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`, color: theme.goldHi, fontFamily: theme.titleFont, fontSize: 150, fontWeight: 900 }}>
        QM RAID
      </div>
      <div style={{ opacity: o(10), color: theme.parchment, fontFamily: theme.bodyFont, fontSize: 52, fontWeight: 700, marginTop: 10 }}>
        Built today by one human and 24 AI agents
      </div>
      <div style={{ opacity: o(22), color: theme.gold, fontFamily: theme.bodyFont, fontSize: 44, marginTop: 30 }}>
        github.com/aemrebarut/qm-raid
      </div>
      <div style={{ opacity: o(34), color: theme.stoneLight, fontFamily: theme.bodyFont, fontSize: 36, marginTop: 24, letterSpacing: 4 }}>
        River AI {"·"} GBrain {"·"} QM
      </div>
    </AbsoluteFill>
  );
};
