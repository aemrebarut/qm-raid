// Owned by raid-video-fx: punch-in zooms, callouts, pops, stamps, bursts, wipes.
// raid-video places these at capture markers via FxCue in ../timeline.ts:
//   overlays: <Sequence from={at * FPS} durationInFrames={CUES[kind].frames}><CUES[kind].C text x y /></Sequence>
//   punch-ins: style={{ transform: punchTransform(frame, fps, cues) }} on the video layer, plus the "punchIn"
//   overlay cue at the same time for the focus lines and flash.
export { CUES, punchTransform } from "./cues";
export { Callout } from "./Callout";
export { Combo } from "./Combo";
export { ForgedBurst } from "./ForgedBurst";
export { Mascot } from "./Mascot";
export { PlusPop } from "./PlusPop";
export { PunchIn } from "./PunchIn";
export { ScoreRace } from "./ScoreRace";
export { SpeedWipe } from "./SpeedWipe";
export { Stamp } from "./Stamp";
export { FxGallery, FX_GALLERY_FRAMES } from "./FxGallery";
