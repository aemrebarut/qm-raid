// Edit planner (raid-video): turns raid-video-cap markers into src/edl.json.
// For each clip: hold 1x windows around the marked events, fast-forward the gaps so the clip fits its slot,
// and place fx cues, lower-third captions and VO anchors at the output time of each event.
// Usage: bun scripts/plan.ts [clipsDir]   (default public/clips). Hand-tune src/edl.json after if needed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Ev = { t: number; name: string; x?: number; y?: number; [k: string]: unknown };
type Seg = { from: number; to: number; rate: number };
type FxRule = { kind: string; text?: string; lead?: number; noXY?: boolean };
type Rule = {
  target: number;
  // event name (or prefix ending in *) -> seconds kept at 1x before and after it
  hold: Record<string, [number, number]>;
  // event -> fx cues; text "$name" takes the event's name field; noXY drops the event position
  fx: Record<string, FxRule | FxRule[]>;
  caps: Record<string, string>;
  // VO line id -> event it starts on
  vo: Record<string, string>;
};

const TITLE = 1.2; // title card at the head of every clip
const MAX_FF = 12;
const CAP_DUR = 2.6;

const RULES: Record<string, Rule> = {
  orders: {
    target: 20,
    hold: { select: [1.2, 1.2], order: [0.3, 2.2], recall_beam: [0.4, 2.4], reply: [0.4, 2.6], order_done: [0.2, 1], remember_orb: [0.4, 2.4], library: [0.2, 1.6] },
    fx: {
      select: { kind: "callout", text: "KNIGHT|a real QM agent" },
      recall_beam: [{ kind: "punchIn" }, { kind: "calloutRecall", text: "RECALL|from GBrain, the Library" }],
      reply: { kind: "callout", text: "REAL QM REPLY|the issue, worked" },
      remember_orb: [{ kind: "pagePop", text: "+1 page" }, { kind: "mascotCheer", text: "One more page!", lead: 0.8 }],
    },
    caps: { order: "Right-click a camp: the knight marches", recall_beam: "Blue beam: recall from the Library (GBrain)", remember_orb: "Gold orb: remembered for the whole army" },
    vo: { vo_orders_1: "select", vo_orders_2: "recall_beam", vo_orders_3: "reply", vo_orders_4: "remember_orb" },
  },
  teams: {
    target: 20,
    hold: { select3: [1, 1], form_team: [0.3, 1.2], trio: [0.3, 1.8], order: [0.3, 1.5], "handoff*": [0.4, 1.6], verdict_approved: [0.5, 2.6], verdict_changes: [0.5, 2], run_done: [0.2, 1.2], camp_resolved: [0.2, 1.4] },
    fx: {
      trio: { kind: "callout", text: "TRIO|planner, implementer, reviewer" },
      "handoff*": { kind: "callout", text: "HANDOFF|the scroll flies" },
      verdict_approved: [{ kind: "punchIn" }, { kind: "approvedStamp", noXY: true }, { kind: "mascotCheer", text: "Approved!", lead: 1.2 }],
      verdict_changes: { kind: "mascotShock", text: "Changes!" },
    },
    caps: { trio: "Form team: the Trio workflow", "handoff*": "Scrolls fly: plan, fix, review", verdict_approved: "The reviewer gives the verdict" },
    vo: { vo_teams_1: "select3", vo_teams_2: "order", vo_teams_3: "handoff*", vo_teams_4: "verdict_approved" },
  },
  forge: {
    target: 20,
    hold: { forge_open: [0.8, 1.2], described: [1.2, 1], forge_submit: [0.3, 1], card: [0.3, 3.2], train: [0.3, 1], spawned: [0.3, 2], unit_spawned: [0.3, 2], order_active: [0.3, 1.5], recall_beam: [0.3, 1.5] },
    fx: {
      forge_open: { kind: "calloutRiver", text: "THE FORGE|River AI" },
      card: [{ kind: "scoreRace", noXY: true, lead: 0.3 }, { kind: "mascotThink", text: "Trained beats base!", lead: 1.5 }],
      spawned: [{ kind: "punchIn" }, { kind: "forgedBurst", text: "$name" }],
    },
    caps: { forge_open: "The Forge: describe a new unit type", card: "River-trained vs base model, held-out test orders", spawned: "River-trained unit, straight to work" },
    vo: { vo_forge_1: "forge_open", vo_forge_2: "described", vo_forge_3: "card", vo_forge_4: "train" },
  },
  autopilot: {
    target: 15,
    hold: { new_issue: [0.6, 0.6], camp_spawned: [0.3, 1.6], autopilot_on: [0.3, 1], proposal: [0.3, 1.8], proposed: [0.3, 1.8], veto: [0.4, 1.6], order_cancelled: [0.2, 0.8], autopilot_go: [0.3, 1.6], order_active: [0.2, 1.2] },
    fx: {
      camp_spawned: [{ kind: "callout", text: "NEW ISSUE|a new camp" }, { kind: "mascotShock", text: "More monsters!", lead: 0.4 }],
      proposed: { kind: "callout", text: "AUTOPILOT|15 s veto ring" },
      veto: [{ kind: "punchIn" }, { kind: "mascotSmug", text: "Not that one." }],
      autopilot_go: { kind: "callout", text: "LET IT RIDE|order goes" },
    },
    caps: { camp_spawned: "New issue: a camp appears", proposed: "Autopilot proposes, 15 s veto ring", veto: "Cancel one, let one go" },
    vo: { vo_auto_1: "new_issue", vo_auto_2: "proposed", vo_auto_3: "veto" },
  },
  loadout: {
    target: 15,
    hold: { "loadout*": [0.6, 1.8], select: [0.8, 1], save: [0.3, 1.6], order: [0.3, 1.6], order_active: [0.3, 1.4] },
    fx: {},
    caps: { "loadout*": "Loadout: the unit's standing orders" },
    vo: { vo_loadout_1: "loadout*", vo_loadout_2: "save" },
  },
};

const match = (table: Record<string, unknown>, name: string): string | undefined =>
  Object.keys(table).find((k) => (k.endsWith("*") ? name.startsWith(k.slice(0, -1)) : k === name));

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function plan(id: string, rule: Rule, doc: { duration: number; events: Ev[] }) {
  const D = doc.duration;
  const evs = doc.events.filter((e) => match(rule.hold, e.name));
  if (!evs.length) return null;
  // 1x windows around events; the first one also covers the title card.
  let wins = evs.map((e, i) => {
    const [pre, post] = rule.hold[match(rule.hold, e.name)!];
    return [Math.max(0, e.t - pre - (i === 0 ? TITLE : 0)), Math.min(D, e.t + post)] as [number, number];
  });
  wins.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of wins) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 0.6) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  wins = merged;
  const H = wins.reduce((s, w) => s + w[1] - w[0], 0);
  const gaps: [number, number][] = [];
  for (let i = 1; i < wins.length; i++) gaps.push([wins[i - 1][1], wins[i][0]]);
  const G = gaps.reduce((s, g) => s + g[1] - g[0], 0);
  const T = rule.target;
  let holdRate = 1;
  let gapRate = G > 0 && T - H > 0.5 ? G / (T - H) : MAX_FF;
  if (gapRate < 1) {
    // More room than action: play gaps at 1x and extend the tail if the source allows.
    gapRate = 1;
    const spare = T - H - G;
    wins[wins.length - 1][1] = Math.min(D, wins[wins.length - 1][1] + spare);
  } else if (gapRate > MAX_FF) {
    gapRate = MAX_FF;
    holdRate = Math.min(2, H / Math.max(0.1, T - G / MAX_FF));
  } else if (G === 0 && H > T) {
    holdRate = Math.min(2, H / T);
  }
  gapRate = Math.round(gapRate * 10) / 10;
  holdRate = Math.round(holdRate * 100) / 100;
  const segs: Seg[] = [];
  wins.forEach((w, i) => {
    segs.push({ from: round(w[0]), to: round(w[1]), rate: holdRate });
    const g = gaps[i];
    if (g && g[1] - g[0] > 0.05) segs.push({ from: round(g[0]), to: round(g[1]), rate: gapRate });
  });
  // Output seconds for a source time; events inside a skipped span land at its end.
  const out = (t: number): number => {
    let acc = 0;
    for (const s of segs) {
      const len = Math.round(((s.to - s.from) / s.rate) * 30) / 30;
      if (t < s.from) return acc;
      if (t <= s.to) return acc + (t - s.from) / s.rate;
      acc += len;
    }
    return acc;
  };
  const fx: { at: number; kind: string; text?: string; x?: number; y?: number }[] = [];
  const captions: { at: number; dur: number; text: string }[] = [];
  const events: { name: string; at: number }[] = [];
  const voAnchor: Record<string, number> = {};
  const seenFx = new Set<string>();
  let capEnd = TITLE + 0.1;
  for (const e of doc.events) {
    const at = round(out(e.t), 2);
    events.push({ name: e.name, at });
    const fk = match(rule.fx, e.name);
    if (fk && !seenFx.has(fk)) {
      seenFx.add(fk);
      for (const f of ([] as FxRule[]).concat(rule.fx[fk])) {
        const text = f.text === "$name" ? String(e.unitName ?? e.typeName ?? "") : f.text;
        const xy = f.noXY ? {} : { x: e.x, y: e.y };
        fx.push({ at: round(Math.max(TITLE, at + (f.lead ?? 0)), 2), kind: f.kind, ...(text ? { text } : {}), ...xy });
      }
    }
    const ck = match(rule.caps, e.name);
    if (ck && !captions.some((c) => c.text === rule.caps[ck])) {
      const s = Math.max(at, capEnd);
      if (s < T - 1) {
        captions.push({ at: round(s, 2), dur: CAP_DUR, text: rule.caps[ck] });
        capEnd = s + CAP_DUR + 0.2;
      }
    }
    for (const [vo, name] of Object.entries(rule.vo)) {
      if (voAnchor[vo] !== undefined) continue;
      if (name.endsWith("*") ? e.name.startsWith(name.slice(0, -1)) : e.name === name) voAnchor[vo] = at;
    }
  }
  const total = segs.reduce((s, g) => s + Math.round(((g.to - g.from) / g.rate) * 30) / 30, 0);
  return { id, src: `clips/${id}.webm`, segments: segs, captions, fx, events, voAnchor, seconds: round(total, 2), holdRate, gapRate };
}

const dir = process.argv[2] ?? join(import.meta.dir, "../public/clips");
const edlPath = join(import.meta.dir, "../src/edl.json");
const prev = existsSync(edlPath) ? JSON.parse(readFileSync(edlPath, "utf8")) : {};
const edl: Record<string, unknown> = { ...prev };
for (const [id, rule] of Object.entries(RULES)) {
  const f = join(dir, `${id}.markers.json`);
  if (!existsSync(f) || !existsSync(join(dir, `${id}.webm`))) {
    console.log(`${id}: no capture`);
    continue;
  }
  const p = plan(id, rule, JSON.parse(readFileSync(f, "utf8")));
  if (!p) {
    console.log(`${id}: no usable events`);
    continue;
  }
  edl[id] = p;
  console.log(`${id}: ${p.seconds}s (target ${rule.target}), hold ${p.holdRate}x, gaps ${p.gapRate}x, ${p.segments.length} segs, ${p.fx.length} fx, ${p.captions.length} caps, vo ${Object.keys(p.voAnchor).join(",")}`);
}
writeFileSync(edlPath, JSON.stringify(edl, null, 2) + "\n");
console.log(`wrote ${edlPath}`);
