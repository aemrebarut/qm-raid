import { AbsoluteFill, Series } from "remotion";
import { Intro } from "../intro/Intro";
import { END_FRAMES, INTRO_FRAMES, clipFrames, clips } from "../timeline";
import { Clip } from "./Clip";
import { EndCard } from "./EndCard";

// The full cut: intro, five capability clips, end card. Audio (VO, music, sfx) is layered here
// from video/audio/manifest.json once raid-video-vo delivers it.
export const Main: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Series>
      <Series.Sequence durationInFrames={INTRO_FRAMES}>
        <Intro />
      </Series.Sequence>
      {clips.map((c, i) => (
        <Series.Sequence key={c.id} durationInFrames={clipFrames(c)}>
          <Clip c={c} index={i + 1} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={END_FRAMES}>
        <EndCard />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);
