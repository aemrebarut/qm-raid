// VO placement (pure, shared by Main and scripts/vo-plan.ts). Each section is resolved as a whole:
// lines start at their capture anchor (edl voAnchor) or manifest offset, never overlap (0.15 s gap),
// and never run past the section end; if the anchors cannot fit, the section uses the manifest offsets.
import { END_FRAMES, FPS, HERO_FRAMES, INTRO_FRAMES, clipFrames, clips, planned } from "../timeline";
import type { VoTrack } from "./audio";

const GAP = 0.15;

// Section start in frames, by id: hero, intro, each clip id, end.
export const sectionStarts = (): Record<string, number> => {
  const out: Record<string, number> = { hero: 0, intro: HERO_FRAMES };
  let at = HERO_FRAMES + INTRO_FRAMES;
  for (const c of clips) {
    out[c.id] = at;
    at += clipFrames(c);
  }
  out.end = at;
  return out;
};

const sectionSeconds = (sec: string): number => {
  const starts = sectionStarts();
  const order = ["hero", "intro", ...clips.map((c) => c.id), "end"];
  const next = order[order.indexOf(sec) + 1];
  return next ? (starts[next] - starts[sec]) / FPS : END_FRAMES / FPS;
};

const idOf = (t: VoTrack) => t.id ?? t.file.replace(/\.[a-z0-9]+$/, "");

const fits = (ts: VoTrack[], at: number[], len: number): boolean =>
  at.every((a, i) => a >= 0 && a + ts[i].duration <= len + 0.001 && (i === 0 || a >= at[i - 1] + ts[i - 1].duration + GAP - 0.001));

export type Placed = { t: VoTrack; section: string; at: number; abs: number; how: "anchor" | "manifest" };

export const placeVo = (tracks: VoTrack[], alts: VoTrack[]): Placed[] => {
  const starts = sectionStarts();
  const out: Placed[] = [];
  const bySection = new Map<string, VoTrack[]>();
  for (const t0 of tracks) {
    if (starts[t0.section] === undefined) continue; // section cut (failed clip)
    const swap = planned[t0.section]?.voSwap?.[idOf(t0)];
    const t = (swap && alts.find((a) => idOf(a) === swap)) || t0;
    bySection.set(t0.section, [...(bySection.get(t0.section) ?? []), t]);
  }
  for (const [sec, ts0] of bySection) {
    const ts = [...ts0].sort((a, b) => a.offset - b.offset);
    const len = sectionSeconds(sec);
    const anchors = ts.map((t) => planned[sec]?.voAnchor?.[idOf(t)]);
    let at = ts.map((t, i) => (anchors[i] !== undefined ? Math.max(1.1, anchors[i]! - 0.2) : t.offset));
    // forward: no overlap
    for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + ts[i - 1].duration + GAP);
    // backward: inside the section, pulling earlier lines back when a later one is clamped
    for (let i = at.length - 1; i >= 0; i--) {
      const limit = i === at.length - 1 ? len - 0.1 - ts[i].duration : at[i + 1] - GAP - ts[i].duration;
      at[i] = Math.min(at[i], limit);
    }
    let how: Placed["how"] = anchors.some((a) => a !== undefined) ? "anchor" : "manifest";
    if (!fits(ts, at, len)) {
      at = ts.map((t) => t.offset);
      how = "manifest";
    }
    ts.forEach((t, i) => out.push({ t, section: sec, at: at[i], abs: starts[sec] / FPS + at[i], how }));
  }
  return out.sort((a, b) => a.abs - b.abs);
};
