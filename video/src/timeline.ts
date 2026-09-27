// The Main cut, owned by raid-video. All times in seconds; FPS converts.
// Clip sources are raw Playwright captures copied (or symlinked) into public/clips/ (gitignored).
// Each clip is a list of speed segments over the source: [from, to) at rate r plays for (to - from) / r seconds.

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// 75 s cut (Emre 16:03): 0:00 to 0:02 real gameplay hero shot (frame 0 is the thumbnail), 11 s anime intro,
// orders 15, teams 14, forge 15, command montage 14 (autopilot then a 3 s loadout edit), end card 4.
export const HERO_SECONDS = 2;
export const INTRO_SECONDS = 11;
export const END_SECONDS = 4;
// Overlap between sections for transitions (frames).
export const TRANSITION_FRAMES = 8;

// src overrides the clip src (the command montage cuts two captures together).
export type Segment = { from: number; to: number; rate: number; src?: string };
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
  { id: "orders", title: "Orders and Memory", subtitle: "A knight answers to GBrain", src: null, segments: [], fallbackSeconds: 15, captions: [], fx: [] },
  { id: "teams", title: "Teams", subtitle: "Planner, implementer, reviewer", src: null, segments: [], fallbackSeconds: 14, captions: [], fx: [] },
  { id: "forge", title: "The Forge", subtitle: "River AI trains new unit types", src: null, segments: [], fallbackSeconds: 15, captions: [], fx: [] },
  { id: "command", title: "Command", subtitle: "New issues, autopilot, loadout", src: null, segments: [], fallbackSeconds: 14, captions: [], fx: [] },
];

export const clips: ClipDef[] = base.map((c) => {
  const p = planned[c.id];
  return p ? { ...c, src: p.src, segments: p.segments, captions: p.captions, fx: p.fx } : c;
});

export const segFrames = (g: Segment): number => Math.round(((g.to - g.from) / g.rate) * FPS);

export const clipFrames = (c: ClipDef): number =>
  c.src && c.segments.length ? c.segments.reduce((s, g) => s + segFrames(g), 0) : Math.round(c.fallbackSeconds * FPS);

export const HERO_FRAMES = HERO_SECONDS * FPS;
export const INTRO_FRAMES = INTRO_SECONDS * FPS;

// Hero source: the dedicated hero capture if planned, else a busy moment of the orders clip.
export const hero = (): { src: string; from: number } | null => {
  const h = (edl as Record<string, { src?: string; from?: number }>).hero;
  if (h?.src) return { src: h.src, from: h.from ?? 0.5 };
  const o = planned.orders;
  if (!o) return null;
  const beam = o.events.find((e) => e.name === "recall_beam");
  const g = o.segments[0];
  return { src: o.src, from: beam ? Math.max(0.3, sourceAt(o.segments, beam.at) - 0.6) : (g?.from ?? 0.5) };
};

// Source seconds at an output time of a planned clip.
export const sourceAt = (segs: Segment[], at: number): number => {
  let acc = 0;
  for (const g of segs) {
    const len = segFrames(g) / FPS;
    if (at <= acc + len) return g.from + (at - acc) * g.rate;
    acc += len;
  }
  return segs.length ? segs[segs.length - 1].to : 0;
};
export const END_FRAMES = END_SECONDS * FPS;

export const mainFrames = (): number =>
  HERO_FRAMES +
  INTRO_FRAMES + clips.reduce((s, c) => s + clipFrames(c), 0) + END_FRAMES;
