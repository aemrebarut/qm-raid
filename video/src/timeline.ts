// The Main cut, owned by raid-video. All times in seconds; FPS converts.
// Clip sources are raw Playwright captures copied (or symlinked) into public/clips/ (gitignored).
// Each clip is a list of speed segments over the source: [from, to) at rate r plays for (to - from) / r seconds.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export const INTRO_SECONDS = 15;
export const END_SECONDS = 4;
// Overlap between sections for transitions (frames).
export const TRANSITION_FRAMES = 8;

export type Segment = { from: number; to: number; rate: number };
export type Caption = { at: number; dur: number; text: string };
// Fx cues placed at capture markers, output seconds relative to the clip start.
export type FxCue = { at: number; kind: string; text?: string; x?: number; y?: number };

export type ClipDef = {
  id: string;
  title: string;
  subtitle: string;
  // file under public/, null renders a placeholder slate of `fallbackSeconds`.
  src: string | null;
  segments: Segment[];
  fallbackSeconds: number;
  captions: Caption[];
  fx: FxCue[];
};

import edl from "./edl.json";

// Planned edit per clip from scripts/plan.ts (capture markers); overrides the defaults below.
export type Planned = {
  src: string;
  segments: Segment[];
  captions: Caption[];
  fx: FxCue[];
  events: { name: string; at: number }[];
  voAnchor: Record<string, number>;
};
export const planned = edl as unknown as Record<string, Planned>;

const base: ClipDef[] = [
  {
    id: "orders",
    title: "Orders and Memory",
    subtitle: "A knight answers to GBrain",
    src: null,
    segments: [],
    fallbackSeconds: 20,
    captions: [],
    fx: [],
  },
  {
    id: "teams",
    title: "Teams",
    subtitle: "Planner, implementer, reviewer",
    src: null,
    segments: [],
    fallbackSeconds: 20,
    captions: [],
    fx: [],
  },
  {
    id: "forge",
    title: "The Forge",
    subtitle: "River AI trains a new unit type",
    src: null,
    segments: [],
    fallbackSeconds: 20,
    captions: [],
    fx: [],
  },
  {
    id: "autopilot",
    title: "Autopilot",
    subtitle: "New issues, 15 second veto",
    src: null,
    segments: [],
    fallbackSeconds: 15,
    captions: [],
    fx: [],
  },
  {
    id: "loadout",
    title: "Loadout",
    subtitle: "Standing orders and skills",
    src: null,
    segments: [],
    fallbackSeconds: 15,
    captions: [],
    fx: [],
  },
];

// Loadout only goes in if its capture exists; otherwise its time goes to the others.
export const clips: ClipDef[] = base
  .filter((c) => c.id !== "loadout" || planned.loadout)
  .map((c) => {
    const p = planned[c.id];
    return p ? { ...c, src: p.src, segments: p.segments, captions: p.captions, fx: p.fx } : c;
  });

export const segFrames = (g: Segment): number => Math.round(((g.to - g.from) / g.rate) * FPS);

export const clipFrames = (c: ClipDef): number =>
  c.src && c.segments.length ? c.segments.reduce((s, g) => s + segFrames(g), 0) : Math.round(c.fallbackSeconds * FPS);

export const INTRO_FRAMES = INTRO_SECONDS * FPS;
export const END_FRAMES = END_SECONDS * FPS;

export const mainFrames = (): number =>
  INTRO_FRAMES + clips.reduce((s, c) => s + clipFrames(c), 0) + END_FRAMES;
