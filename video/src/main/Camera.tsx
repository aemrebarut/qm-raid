import { AbsoluteFill, spring, useCurrentFrame } from "remotion";
import { ClipDef, FPS, planned, segFrames } from "../timeline";

// Camera layer over every gameplay and QM clip (Emre 16:38: "zoom ins and zoom outs so everything feels dynamic"):
// a slow drift that reframes every 3 s, a spring punch-in onto each action point held ~1.3 s then snapped back
// to the wide map, a small shake on strikes, and a zoom blur on every RTS <-> QM cut.
const W = 1920;
const H = 1080;
const KEY = new Set([
  "select3", "trio", "order", "recall_beam", "remember_orb", "camp_resolved", "library", "handoff_1", "handoff_2",
  "verdict_changes", "run_needs_human", "forge_open", "card", "spawned", "new_issue", "camp_spawned", "proposed",
  "veto", "autopilot_go", "save", "qm_order", "qm_reply",
]);
const SHAKE = new Set(["camp_spawned", "new_issue", "verdict_changes", "spawned", "camp_resolved", "run_needs_human", "veto"]);
// where the action is when the marker carries no position (capture frame pixels)
const SPOT: Record<string, [number, number]> = {
  proposed: [220, 1000],
  veto: [220, 1010],
  autopilot_go: [220, 1010],
  run_needs_human: [200, 1000],
  verdict_changes: [1720, 820],
  save: [1640, 890],
  qm_order: [960, 620],
  qm_reply: [960, 660],
  library: [900, 420],
};
// rev P1 on v2: the camera cropped the Forge card scores and Train controls, and the Autopilot proposal rows and Go
// control (bottom left). Forge runs without the camera; Autopilot only punches on the new camp, before any proposal
// shows, and does not drift.
const OFF = new Set(["forge"]);
const ONLY: Record<string, Set<string>> = { autopilot: new Set(["new_issue", "camp_spawned"]) };
const PUNCH = 1.55;
const IN = 10;
const HOLD = 40;
const OUT = 8;
const GAP = 2.0; // seconds between punches, so the framing changes every 2 to 4 s
const DRIFT = [
  { s: 1.02, x: 760, y: 480 },
  { s: 1.08, x: 1160, y: 560 },
  { s: 1.04, x: 960, y: 420 },
  { s: 1.07, x: 840, y: 640 },
];
const BLOCK = 90;
const BLEND = 24;
const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};

type Punch = { f: number; x: number; y: number; shake: boolean };

const punches = (c: ClipDef): Punch[] => {
  const out: Punch[] = [];
  let last = -Infinity;
  for (const e of planned[c.id]?.events ?? []) {
    if (!KEY.has(e.name) || e.at < 0.9) continue;
    if (ONLY[c.id] && !ONLY[c.id].has(e.name)) continue;
    if (e.at - last < GAP) continue;
    // loadout's close-up is already zoomed before save; only punch in the wide view
    const seg = segAt(c, e.at);
    if (seg?.zoom) continue;
    const cue = c.fx.find((k) => Math.abs(k.at - e.at) < 0.35 && k.x !== undefined && k.y !== undefined);
    const [x, y] = cue ? [cue.x!, cue.y!] : SPOT[e.name] ?? [960, 540];
    out.push({ f: Math.round(e.at * FPS), x, y, shake: SHAKE.has(e.name) });
    last = e.at;
  }
  return out;
};

const segAt = (c: ClipDef, t: number) => {
  let acc = 0;
  for (const g of c.segments) {
    const len = segFrames(g);
    if (t * FPS < acc + len) return g;
    acc += len;
  }
  return undefined;
};

const cuts = (c: ClipDef): number[] => {
  const out: number[] = [];
  let acc = 0;
  c.segments.forEach((g, i) => {
    if (i > 0 && (g.label ?? "") !== (c.segments[i - 1].label ?? "")) out.push(acc);
    acc += segFrames(g);
  });
  return out;
};

export const Camera: React.FC<{ c: ClipDef; children: React.ReactNode }> = ({ c, children }) => {
  const frame = useCurrentFrame();
  if (OFF.has(c.id)) return <>{children}</>;
  const still = Boolean(ONLY[c.id]);
  // drift: blend between framings every BLOCK frames
  const b = Math.floor(frame / BLOCK);
  const cur = DRIFT[b % DRIFT.length];
  const prev = DRIFT[(b + DRIFT.length - 1) % DRIFT.length];
  const m = b === 0 ? 1 : smooth((frame - b * BLOCK) / BLEND);
  const wob = 0.01 * Math.sin((frame / FPS) * 0.9);
  const ds = still ? 1 : prev.s + (cur.s - prev.s) * m + wob;
  const dx = prev.x + (cur.x - prev.x) * m;
  const dy = prev.y + (cur.y - prev.y) * m;

  // punch: spring in, hold, snap out
  let k = 1;
  let px = 960;
  let py = 540;
  let tx = 0;
  let ty = 0;
  for (const p of punches(c)) {
    const f = frame - p.f;
    if (f < 0 || f >= IN + HOLD + OUT) continue;
    const pop = spring({ frame: f, fps: FPS, config: { damping: 14, stiffness: 240, mass: 0.6 }, durationInFrames: IN });
    const out = f < IN + HOLD ? 1 : 1 - smooth((f - IN - HOLD) / OUT);
    const a = Math.min(pop, 1.05) * out;
    k = 1 + (PUNCH - 1) * a;
    px = p.x;
    py = p.y;
    // pull the subject toward center, never past the frame's overflow (no black edges)
    tx = Math.max(-(W - px) * (k - 1), Math.min(px * (k - 1), (960 - px) * 0.35 * a));
    ty = Math.max(-(H - py) * (k - 1), Math.min(py * (k - 1), (540 - py) * 0.35 * a));
    if (p.shake && f < 12) {
      const amp = 9 * (1 - f / 12);
      tx += Math.sin(f * 2.3) * amp;
      ty += Math.cos(f * 3.1) * amp;
    }
  }

  // zoom blur on RTS <-> QM cuts
  let blur = 0;
  let zb = 1;
  for (const at of cuts(c)) {
    const d = Math.abs(frame - at);
    if (d > 7) continue;
    const w = 1 - d / 7;
    blur = Math.max(blur, 16 * w);
    zb = Math.max(zb, 1 + 0.22 * w);
  }

  return (
    <AbsoluteFill style={{ transform: `scale(${ds * zb})`, transformOrigin: `${dx}px ${dy}px`, filter: blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : undefined }}>
      <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})`, transformOrigin: `${px}px ${py}px` }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
