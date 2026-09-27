import { Composition } from "remotion";
import { Intro } from "./intro/Intro";
import { Main } from "./main/Main";
import { Clip } from "./main/Clip";
import { EndCard } from "./main/EndCard";
import { FPS, HEIGHT, INTRO_FRAMES, END_FRAMES, WIDTH, clipFrames, clips, mainFrames } from "./timeline";

export const Root: React.FC = () => (
  <>
    <Composition id="Intro" component={Intro} durationInFrames={INTRO_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
    <Composition id="Main" component={Main} durationInFrames={mainFrames()} fps={FPS} width={WIDTH} height={HEIGHT} />
    {clips.map((c, i) => (
      <Composition
        key={c.id}
        id={`Clip-${c.id}`}
        component={() => <Clip c={c} index={i + 1} />}
        durationInFrames={clipFrames(c)}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    ))}
    <Composition id="EndCard" component={EndCard} durationInFrames={END_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
