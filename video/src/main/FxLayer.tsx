// Places raid-video-fx overlays at cue times. Unknown kinds are skipped so the cut always builds.
import * as fx from "../fx";
import { Sequence } from "remotion";
import { FPS, FxCue } from "../timeline";

type CueDef = { frames: number; C: React.FC<{ text?: string; x?: number; y?: number }> };
const registry = (): Record<string, CueDef> => ((fx as Record<string, unknown>).CUES as Record<string, CueDef>) ?? {};

export const punch = (frame: number, cues: FxCue[]): string | undefined => {
  const f = (fx as Record<string, unknown>).punchTransform as
    | ((frame: number, fps: number, cues: FxCue[]) => string)
    | undefined;
  return f ? f(frame, FPS, cues) : undefined;
};

export const FxLayer: React.FC<{ cues: FxCue[] }> = ({ cues }) => {
  const reg = registry();
  return (
    <>
      {cues.map((q, i) => {
        const d = reg[q.kind];
        if (!d) return null;
        return (
          <Sequence key={i} from={Math.round(q.at * FPS)} durationInFrames={d.frames} layout="none">
            <d.C text={q.text} x={q.x} y={q.y} />
          </Sequence>
        );
      })}
    </>
  );
};
