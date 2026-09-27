// Places raid-video-fx overlays at cue times. Unknown kinds are skipped so the cut always builds.
import { Sequence } from "remotion";
import { CUES, punchTransform } from "../fx";
import { FPS, FxCue } from "../timeline";

export const punch = (frame: number, cues: FxCue[]): string => punchTransform(frame, FPS, cues);

export const FxLayer: React.FC<{ cues: FxCue[] }> = ({ cues }) => (
  <>
    {cues.map((q, i) => {
      const d = CUES[q.kind];
      if (!d) return null;
      return (
        <Sequence key={i} from={Math.round(q.at * FPS)} durationInFrames={d.frames}>
          <d.C text={q.text} x={q.x} y={q.y} />
        </Sequence>
      );
    })}
  </>
);
