// Places raid-video-fx overlays at cue times. Unknown kinds are skipped so the cut always builds.
// A cue with `hold` (seconds) freezes on its last full frame before the 8 frame fade, then fades as usual,
// e.g. so the score race's final values stay readable.
import { Freeze, Sequence } from "remotion";
import { CUES, punchTransform } from "../fx";
import { FPS, FxCue } from "../timeline";

const FADE = 10; // fx fade out is 8 frames; freeze just before it

export const punch = (frame: number, cues: FxCue[]): string => punchTransform(frame, FPS, cues);

export const FxLayer: React.FC<{ cues: FxCue[] }> = ({ cues }) => (
  <>
    {cues.map((q, i) => {
      const d = CUES[q.kind];
      if (!d) return null;
      const start = Math.round(q.at * FPS);
      const el = <d.C text={q.text} x={q.x} y={q.y} />;
      const hold = Math.round((q.hold ?? 0) * FPS);
      if (!hold) {
        return (
          <Sequence key={i} from={start} durationInFrames={d.frames}>
            {el}
          </Sequence>
        );
      }
      const body = d.frames - FADE;
      return (
        <Sequence key={i} from={start} durationInFrames={d.frames + hold}>
          <Sequence durationInFrames={body}>{el}</Sequence>
          <Sequence from={body} durationInFrames={hold}>
            <Freeze frame={body - 1}>{el}</Freeze>
          </Sequence>
          <Sequence from={body + hold} durationInFrames={FADE}>
            <Sequence from={-body}>{el}</Sequence>
          </Sequence>
        </Sequence>
      );
    })}
  </>
);
