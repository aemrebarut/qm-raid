import { AbsoluteFill, Audio, Sequence, Series, staticFile } from "remotion";
import { VoTrack, useManifest } from "./audio";
import { Intro } from "../intro/Intro";
import { CUES } from "../fx";
import { END_FRAMES, FPS, HERO_FRAMES, INTRO_FRAMES, clipFrames, clips, planned } from "../timeline";
import { Hero } from "./Hero";
import { Clip } from "./Clip";
import { EndCard } from "./EndCard";

// The full cut: 2 s gameplay hero (frame 0 = thumbnail), 13 s anime intro, five capability clips, end card. Audio (VO, music, sfx) is layered here
// from video/audio/manifest.json once raid-video-vo delivers it.
// Section start in frames, by id: intro, each clip id, end.
export const sectionStarts = (): Record<string, number> => {
  const out: Record<string, number> = { hero: 0, intro: HERO_FRAMES };
  let at = HERO_FRAMES + INTRO_FRAMES;
  for (const c of clips) {
    out[c.id] = at;
    at += clipFrames(c);
  }
  out.end = at;
  return out;
};

// VO line start (seconds from its section start): the capture event it is anchored to (edl voAnchor), else the
// manifest offset; pushed later so lines in a section never overlap.
const placeVo = (tracks: VoTrack[], alts: VoTrack[]): { t: VoTrack; at: number }[] => {
  const starts = sectionStarts();
  const order = ["hero", "intro", ...clips.map((c) => c.id), "end"];
  const len = (sec: string): number => {
    const i = order.indexOf(sec);
    const next = order[i + 1];
    return next ? (starts[next] - starts[sec]) / FPS : END_FRAMES / FPS;
  };
  const lastEnd: Record<string, number> = {};
  const idOf = (t: VoTrack) => t.id ?? t.file.replace(/\.[a-z0-9]+$/, "");
  return tracks.map((t0) => {
    const swap = planned[t0.section]?.voSwap?.[idOf(t0)];
    const t = (swap && alts.find((a) => idOf(a) === swap)) || t0;
    const anchor = planned[t.section]?.voAnchor?.[idOf(t)];
    const want = anchor !== undefined ? Math.max(1.1, anchor - 0.2) : t.offset;
    // never overlap the previous line, never run past the section end
    const at = Math.min(Math.max(want, lastEnd[t.section] ?? 0), Math.max(0, len(t.section) - t.duration - 0.1));
    lastEnd[t.section] = at + t.duration + 0.15;
    return { t, at };
  });
};

const WIPE = CUES.speedWipe;

const AudioBed: React.FC = () => {
  const m = useManifest();
  if (!m) return null;
  const starts = sectionStarts();
  return (
    <>
      {m.music ? <Audio src={staticFile(`audio/${m.music.file}`)} volume={m.music.volume ?? 0.25} /> : null}
      {placeVo(m.tracks ?? [], m.alts ?? []).map(({ t, at }, i) =>
        starts[t.section] === undefined ? null : (
          <Sequence key={`vo${i}`} from={starts[t.section] + Math.round(at * FPS)} layout="none">
            <Audio src={staticFile(`audio/${t.file}`)} volume={t.volume ?? 1} />
          </Sequence>
        ),
      )}
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
        <EndCard />
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
