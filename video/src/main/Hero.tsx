// 0:00 to 0:02: real gameplay, sharp from frame 0 (it is the thumbnail), small QM Raid lockup, then a smash cut.
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FPS, hero } from "../timeline";
import { theme } from "../theme";

export const Hero: React.FC = () => {
  const f = useCurrentFrame();
  const h = hero();
  // Slow push-in so the still frame reads as motion; scale 1 at frame 0 keeps the thumbnail sharp.
  const s = interpolate(f, [0, 60], [1, 1.06]);
  return (
    <AbsoluteFill style={{ background: theme.night }}>
      <AbsoluteFill style={{ transform: `scale(${s})` }}>
        {h ? <OffthreadVideo src={staticFile(h.src)} startFrom={Math.round(h.from * FPS)} muted /> : null}
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 56,
          bottom: 48,
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          background: "rgba(16,21,28,0.82)",
          border: `3px solid ${theme.gold}`,
          borderRadius: 10,
          padding: "10px 26px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}
      >
        <span style={{ color: theme.goldHi, fontFamily: theme.titleFont, fontSize: 64, fontWeight: 900, letterSpacing: 2 }}>QM RAID</span>
        <span style={{ color: theme.parchment, fontFamily: theme.bodyFont, fontSize: 26, fontWeight: 600 }}>an RTS for your AI agents</span>
      </div>
    </AbsoluteFill>
  );
};
