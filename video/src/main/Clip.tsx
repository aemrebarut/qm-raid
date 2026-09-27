import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ClipDef, FPS, clipFrames, segFrames } from "../timeline";
import { theme } from "../theme";
import { FxLayer, punch } from "./FxLayer";
import { LowerThird } from "./LowerThird";
import { TitleCard } from "./TitleCard";

const TITLE_FRAMES = 30;

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
  const frame = useCurrentFrame();
  let at = 0;
  return (
    <AbsoluteFill style={{ background: theme.night }}>
      <AbsoluteFill style={{ transform: punch(frame, c.fx) }}>
      {c.src && c.segments.length ? (
        c.segments.map((g, i) => {
          const len = segFrames(g);
          const from = at;
          at += len;
          return (
            <Sequence key={i} from={from} durationInFrames={len}>
              <AbsoluteFill style={g.zoom ? { transform: `scale(${g.zoom.s})`, transformOrigin: `${g.zoom.x}px ${g.zoom.y}px` } : undefined}>
                <OffthreadVideo src={staticFile(g.src ?? c.src!)} startFrom={Math.round(g.from * FPS)} playbackRate={g.rate} muted />
              </AbsoluteFill>
              {g.rate > 2 && len > 12 ? <FastForward rate={Math.round(g.rate)} /> : null}
            </Sequence>
          );
        })
      ) : (
        <Placeholder c={c} />
      )}
      </AbsoluteFill>
      <FxLayer cues={c.fx} />
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
