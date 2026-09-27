import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";
import { useManifest } from "./audio";
import { Intro } from "../intro/Intro";
import { END_FRAMES, FPS, INTRO_FRAMES, clipFrames, clips } from "../timeline";
import { Clip } from "./Clip";
import { EndCard } from "./EndCard";

// The full cut: intro, five capability clips, end card. Audio (VO, music, sfx) is layered here
// from video/audio/manifest.json once raid-video-vo delivers it.
// Section start in frames, by id: intro, each clip id, end.
export const sectionStarts = (): Record<string, number> => {
  const out: Record<string, number> = { intro: 0 };
  let at = INTRO_FRAMES;
  for (const c of clips) {
    out[c.id] = at;
    at += clipFrames(c);
  }
  out.end = at;
  return out;
};

const AudioBed: React.FC = () => {
  const m = useManifest();
  if (!m) return null;
  const starts = sectionStarts();
  return (
    <>
      {m.music ? <Audio src={staticFile(`audio/${m.music.file}`)} volume={m.music.volume ?? 0.25} /> : null}
      {(m.tracks ?? []).map((t, i) =>
        starts[t.section] === undefined ? null : (
          <Sequence key={`vo${i}`} from={starts[t.section] + Math.round(t.offset * FPS)} layout="none">
            <Audio src={staticFile(`audio/${t.file}`)} volume={t.volume ?? 1} />
          </Sequence>
        ),
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
