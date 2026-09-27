// Standalone entry for the fx gallery (raid-video-fx review renders); the Main cut uses ../index.ts.
// npx remotion still src/fx/entry.tsx FxGallery out/fx.png --frame=N
import React from "react";
import { Composition, registerRoot } from "remotion";
import { FxGallery, FX_GALLERY_FRAMES } from "./FxGallery";

const FxRoot: React.FC = () => (
  <Composition id="FxGallery" component={FxGallery} durationInFrames={FX_GALLERY_FRAMES} fps={30} width={1920} height={1080} />
);
registerRoot(FxRoot);
