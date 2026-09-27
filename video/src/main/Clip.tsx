import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ClipDef, FPS, clipFrames } from "../timeline";
import { theme } from "../theme";
import { LowerThird } from "./LowerThird";
import { TitleCard } from "./TitleCard";

const TITLE_FRAMES = 36;

const FastForward: React.FC<{ rate: number }> = ({ rate }) => {
  const f = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        right: 60,
        background: "rgba(16,21,28,0.85)",
        border: `3px solid ${theme.gold}`,
        borderRadius: 10,
        padding: "8px 20px",
        color: theme.goldHi,
        fontFamily: theme.bodyFont,
        fontWeight: 900,
        fontSize: 40,
        opacity: Math.floor(f / 8) % 2 === 0 ? 1 : 0.75,
      }}
    >
      {"▶▶"} {rate}x
    </div>
  );
};

const Placeholder: React.FC<{ c: ClipDef }> = ({ c }) => (
  <AbsoluteFill style={{ background: theme.slate, justifyContent: "center", alignItems: "center" }}>
    <div style={{ color: theme.stoneLight, fontFamily: theme.bodyFont, fontSize: 48 }}>
      [capture pending: {c.id}]
    </div>
  </AbsoluteFill>
);

export const Clip: React.FC<{ c: ClipDef; index: number }> = ({ c, index }) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: theme.night }}>
      {c.src && c.segments.length ? (
        c.segments.map((g, i) => {
          const len = Math.round(((g.to - g.from) / g.rate) * FPS);
          const from = at;
          at += len;
          return (
            <Sequence key={i} from={from} durationInFrames={len}>
              <OffthreadVideo src={staticFile(c.src!)} startFrom={Math.round(g.from * FPS)} playbackRate={g.rate} muted />
              {g.rate > 2 ? <FastForward rate={g.rate} /> : null}
            </Sequence>
          );
        })
      ) : (
        <Placeholder c={c} />
      )}
      {c.captions.map((k, i) => (
        <Sequence key={`cap${i}`} from={Math.round(k.at * FPS)} durationInFrames={Math.round(k.dur * FPS)}>
          <LowerThird text={k.text} frames={Math.round(k.dur * FPS)} />
        </Sequence>
      ))}
      <Sequence durationInFrames={Math.min(TITLE_FRAMES, clipFrames(c))}>
        <TitleCard index={index} title={c.title} subtitle={c.subtitle} frames={TITLE_FRAMES} />
      </Sequence>
    </AbsoluteFill>
  );
};
