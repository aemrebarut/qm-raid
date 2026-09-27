import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";
import { useManifest } from "./audio";
import { placeVo, sectionStarts } from "./voPlace";
import { Intro } from "../intro/Intro";
import { CUES } from "../fx";
import { END_FRAMES, FPS, HERO_FRAMES, INTRO_FRAMES, clipFrames, clips, planned } from "../timeline";
import { Hero } from "./Hero";
import { Clip } from "./Clip";
import { EndCardAnime } from "../intro/EndCard";

// The full cut: 2 s gameplay hero (frame 0 = thumbnail), 13 s anime intro, five capability clips, end card. Audio (VO, music, sfx) is layered here
// from video/audio/manifest.json once raid-video-vo delivers it.
const WIPE = CUES.speedWipe;

const AudioBed: React.FC = () => {
  const m = useManifest();
  if (!m) return null;
  const starts = sectionStarts();
  return (
    <>
      {m.music ? <Audio src={staticFile(`audio/${m.music.file}`)} volume={m.music.volume ?? 0.25} /> : null}
      {placeVo(m.tracks ?? [], m.alts ?? []).map(({ t, abs }, i) => (
        <Sequence key={`vo${i}`} from={Math.round(abs * FPS)} layout="none">
          <Audio src={staticFile(`audio/${t.file}`)} volume={t.volume ?? 1} />
        </Sequence>
      ))}
      {clips.flatMap((c) =>
        (planned[c.id]?.sfx ?? []).map((x, i) => (
          <Sequence key={`csfx-${c.id}-${i}`} from={starts[c.id] + Math.round(x.at * FPS)} layout="none">
            <Audio src={staticFile(`audio/${x.file}`)} volume={0.7} />
          </Sequence>
        )),
      )}
      {(m.sfx ?? []).map((x, i) => (
        <Sequence key={`sfx${i}`} from={Math.round(x.at * FPS)} layout="none">
          <Audio src={staticFile(`audio/${x.file}`)} volume={x.volume ?? 0.8} />
        </Sequence>
      ))}
    </>
  );
};

export const Main: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    <AudioBed />
    <Series>
      <Series.Sequence durationInFrames={HERO_FRAMES}>
        <Hero />
      </Series.Sequence>
      <Series.Sequence durationInFrames={INTRO_FRAMES}>
        <Intro />
      </Series.Sequence>
      {clips.map((c, i) => (
        <Series.Sequence key={c.id} durationInFrames={clipFrames(c)}>
          <Clip c={c} index={i + 1} />
        </Series.Sequence>
      ))}
      <Series.Sequence durationInFrames={END_FRAMES}>
        <EndCardAnime />
      </Series.Sequence>
    </Series>
    {WIPE
      ? Object.entries(sectionStarts())
          // the intro ends on its own white wipe
          .filter(([k]) => k !== "hero" && k !== "intro" && k !== clips[0].id)
          .map(([k, at]) => (
            <Sequence key={`wipe-${k}`} from={at - Math.floor(WIPE.frames / 2)} durationInFrames={WIPE.frames}>
              <WIPE.C />
            </Sequence>
          ))
      : null}
  </AbsoluteFill>
);
