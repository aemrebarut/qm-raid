// Placeholder. Owned by raid-video-intro: replace freely, keep the export name `Intro`
// and the 15 s length (INTRO_SECONDS in ../timeline.ts).
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { theme } from "../theme";

export const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const s = interpolate(f, [0, 20], [1.4, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: theme.night, justifyContent: "center", alignItems: "center" }}>
      <div style={{ transform: `scale(${s})`, color: theme.gold, fontFamily: theme.titleFont, fontSize: 160, fontWeight: 900 }}>
        QM RAID
      </div>
    </AbsoluteFill>
  );
};
