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
  // event -> sfx file under audio/
  sfx?: Record<string, string>;
};

const TITLE = 1.0; // title card at the head of every clip
const MAX_FF = 12;
const CAP_DUR = 2.6;

const RULES: Record<string, Rule> = {
  orders: {
    target: 15,
    hold: { select: [1.2, 1.2], order: [0.3, 2.2], recall_beam: [0.4, 2.4], reply: [0.4, 2.6], order_done: [0.2, 1], remember_orb: [0.4, 2.4], library: [0.2, 1.6] },
    fx: {
      select: { kind: "callout", text: "KNIGHT|a real QM agent" },
      recall_beam: [{ kind: "punchIn" }, { kind: "calloutRecall", text: "RECALL|from GBrain, the Library" }],
      reply: { kind: "callout", text: "REAL QM REPLY|the issue, worked" },
      remember_orb: [{ kind: "pagePop", text: "+1 page" }, { kind: "mascotCheer", text: "One more page!", lead: 0.8 }],
    },
    caps: { order: "Right-click a camp: the knight marches", recall_beam: "Blue beam: recall from the Library (GBrain)", remember_orb: "Gold orb: remembered for the whole army" },
    vo: { vo_orders_1: "select", vo_orders_2: "recall_beam", vo_orders_3: "remember_orb" },
    sfx: { recall_beam: "sfx_beam.wav", remember_orb: "sfx_orb.wav" },
  },
  teams: {
    target: 14,
    hold: { select3: [1, 1], form_team: [0.3, 1.2], trio: [0.3, 1.8], order: [0.3, 1.5], "handoff*": [0.4, 1.6], verdict_approved: [0.5, 2.6], verdict_changes: [0.5, 2], run_done: [0.2, 1.2], camp_resolved: [0.2, 1.4] },
    fx: {
      trio: { kind: "callout", text: "TRIO|planner, implementer, reviewer" },
      "handoff*": { kind: "callout", text: "HANDOFF|the scroll flies" },
      verdict_approved: [{ kind: "punchIn" }, { kind: "approvedStamp", noXY: true }, { kind: "mascotCheer", text: "Approved!", lead: 1.2 }],
      verdict_changes: { kind: "mascotShock", text: "Changes!" },
    },
    caps: { trio: "Form team: the Trio workflow", "handoff*": "Scrolls fly: plan, fix, review", verdict_approved: "The reviewer gives the verdict" },
    vo: { vo_teams_1: "select3", vo_teams_2: "handoff*", vo_teams_2b: "handoff*", vo_teams_3: "verdict_approved", vo_teams_3b: "verdict_changes" },
    sfx: { "handoff*": "sfx_scroll.wav", verdict_approved: "sfx_chime.wav" },
  },
  forge: {
    target: 15,
    hold: { forge_open: [0.8, 1.2], described: [1.2, 1], forge_submit: [0.3, 1], card: [0.3, 3.2], train: [0.3, 1], spawned: [0.3, 2], unit_spawned: [0.3, 2], order_active: [0.3, 1.5], recall_beam: [0.3, 1.5] },
    fx: {
      forge_open: { kind: "calloutRiver", text: "THE FORGE|River AI" },
      card: [{ kind: "scoreRace", noXY: true, lead: 0.3, text: "Refund Ranger 0.82 vs 0.42; Rule Warden 0.917 vs 0.557|Held-out orders" }, { kind: "mascotCheer", text: "Trained beats base!", lead: 1.5 }],
      spawned: [{ kind: "punchIn" }, { kind: "forgedBurst", text: "$name" }],
    },
    caps: { forge_open: "The Forge: describe a new unit type", card: "River-trained vs base model, held-out test orders", spawned: "River-trained unit, straight to work" },
    vo: { vo_forge_1: "forge_open", vo_forge_2: "card", vo_forge_3: "train" },
    sfx: { train: "sfx_hammer.wav" },
  },
  autopilot: {
    target: 11, // command montage part 1 (14 s without a loadout capture)
    hold: { new_issue: [0.6, 0.6], camp_spawned: [0.3, 1.6], autopilot_on: [0.3, 1], proposal: [0.3, 1.8], proposed: [0.3, 1.8], veto: [0.4, 1.6], order_cancelled: [0.2, 0.8], autopilot_go: [0.3, 1.6], order_active: [0.2, 1.2] },
    fx: {
      camp_spawned: [{ kind: "callout", text: "NEW ISSUE|a new camp" }, { kind: "mascotShock", text: "More monsters!", lead: 0.4 }],
      proposed: { kind: "callout", text: "AUTOPILOT|15 s veto ring" },
      veto: [{ kind: "punchIn" }, { kind: "mascotSmug", text: "Not that one." }],
      autopilot_go: { kind: "callout", text: "LET IT RIDE|order goes" },
    },
    caps: { camp_spawned: "New issue: a camp appears", proposed: "Autopilot proposes, 15 s veto ring", veto: "Cancel one, let one go" },
    vo: { vo_auto_1: "new_issue", vo_auto_2: "proposed" },
  },
  loadout: {
    target: 3, // command montage part 2
    hold: { "loadout*": [0.3, 1.2], save: [0.3, 1.0] },
    fx: {},
    caps: { "loadout*": "Loadout: the unit's standing orders" },
    vo: { vo_loadout_1: "loadout*" },
  },
};

const match = (table: Record<string, unknown>, name: string): string | undefined =>
  Object.keys(table).find((k) => (k.endsWith("*") ? name.startsWith(k.slice(0, -1)) : k === name));

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function plan(id: string, rule: Rule, doc: { duration: number; events: Ev[] }, ext: string, title = TITLE, target = rule.target) {
  const D = doc.duration;
  const evs = doc.events.filter((e) => match(rule.hold, e.name));
  if (!evs.length) return null;
  // 1x windows around events; the first one also covers the title card.
  let wins = evs.map((e, i) => {
    const [pre, post] = rule.hold[match(rule.hold, e.name)!];
    return [Math.max(0, e.t - pre - (i === 0 ? title : 0)), Math.min(D, e.t + post)] as [number, number];
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
  const T = target;
  let holdRate = 1;
  let gapRate = G > 0 && T - H > 0.5 ? G / (T - H) : Infinity;
  if (gapRate < 1) {
    // More room than action: play gaps at 1x and extend the tail if the source allows.
    gapRate = 1;
    const spare = T - H - G;
    wins[wins.length - 1][1] = Math.min(D, wins[wins.length - 1][1] + spare);
    // Source too short to fill the slot: slow the holds a little (not below 0.7x) so sections keep their times.
    const have = wins.reduce((a, w) => a + w[1] - w[0], 0) + G;
    if (have < T - 0.1) holdRate = Math.max(0.7, (have - G) / (T - G));
  } else if (gapRate > MAX_FF) {
    // Holds alone overrun the slot: gaps at max fast-forward, holds sped up to fit (warns above 1.6x).
    gapRate = G > 0 ? MAX_FF : 1;
    holdRate = Math.max(1, H / Math.max(0.5, T - G / gapRate));
    if (holdRate > 1.6) console.log(`  ${id}: holds need ${holdRate.toFixed(2)}x, trim hold windows in RULES`);
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
  const sfx: { file: string; at: number }[] = [];
  const seenFx = new Set<string>();
  let capEnd = title + 0.1;
  for (const e of doc.events) {
    const at = round(out(e.t), 2);
    events.push({ name: e.name, at });
    const fk = match(rule.fx, e.name);
    if (fk && !seenFx.has(fk)) {
      seenFx.add(fk);
      for (const f of ([] as FxRule[]).concat(rule.fx[fk])) {
        const text = f.text === "$name" ? String(e.unitName ?? e.typeName ?? "") : f.text;
        const xy = f.noXY ? {} : { x: e.x, y: e.y };
        fx.push({ at: round(Math.max(title, at + (f.lead ?? 0)), 2), kind: f.kind, ...(text ? { text } : {}), ...xy });
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
    const sk = rule.sfx && match(rule.sfx, e.name);
    if (sk && !sfx.some((x) => x.file === rule.sfx![sk])) sfx.push({ file: rule.sfx![sk], at });
    for (const [vo, name] of Object.entries(rule.vo)) {
      if (voAnchor[vo] !== undefined) continue;
      if (name.endsWith("*") ? e.name.startsWith(name.slice(0, -1)) : e.name === name) voAnchor[vo] = at;
    }
  }
  const total = segs.reduce((s, g) => s + Math.round(((g.to - g.from) / g.rate) * 30) / 30, 0);
  const src = `clips/${id}.${ext}`;
  // Final verdict CHANGES (no approval in the take): the alt line replaces the approval line.
  const voSwap: Record<string, string> = {};
  if (voAnchor.vo_teams_3b !== undefined && voAnchor.vo_teams_3 === undefined) voSwap.vo_teams_3 = "vo_teams_3b";
  // --warden: the take shows the Rule Warden reviewing (checked on the frames), so the line may name it.
  if (id === "teams" && process.argv.includes("--warden")) voSwap.vo_teams_2 = "vo_teams_2b";
  return { id, src, sfx, voSwap, segments: segs.map((g) => ({ ...g, src })), captions, fx, events, voAnchor, seconds: round(total, 2), holdRate, gapRate };
}

const dir = process.argv[2] ?? join(import.meta.dir, "../public/clips");
const edlPath = join(import.meta.dir, "../src/edl.json");
const edl: Record<string, unknown> = {};
// --real: skip mock captures (the final take). Loadout always comes from the approved mock close-up.
const realOnly = process.argv.includes("--real");
const LOADOUT_DIR = join(process.env.HOME ?? "", "Workspace/qm-raid-video/mock-loadout");
const dirFor = (id: string) => (id === "loadout" && existsSync(LOADOUT_DIR) ? LOADOUT_DIR : dir);
const loadoutCaptured = ["mp4", "webm"].some((x) => existsSync(join(dirFor("loadout"), `loadout.${x}`))) && existsSync(join(dirFor("loadout"), "loadout.markers.json"));
for (const [id, rule] of Object.entries(RULES)) {
  const d = dirFor(id);
  const f = join(d, `${id}.markers.json`);
  const ext = ["mp4", "webm"].find((x) => existsSync(join(d, `${id}.${x}`)));
  if (!existsSync(f) || !ext) {
    console.log(`${id}: no capture`);
    delete edl[id];
    continue;
  }
  const doc = JSON.parse(readFileSync(f, "utf8"));
  if (realOnly && doc.backend === "mock" && id !== "loadout") {
    console.log(`${id}: mock capture skipped (--real)`);
    delete edl[id];
    continue;
  }
  const p =
    id === "loadout"
      ? plan(id, rule, doc, ext, 0)
      : plan(id, rule, doc, ext, TITLE, id === "autopilot" && !loadoutCaptured ? 14 : rule.target);
  if (!p) {
    console.log(`${id}: no usable events`);
    continue;
  }
  if (d !== dir) p.src = p.src.replace("clips/", "mock-loadout/");
  p.segments = p.segments.map((g) => ({ ...g, src: p.src }));
  edl[id] = p;
  console.log(`${id} [${doc.backend}]: ${p.seconds}s (target ${rule.target}), hold ${p.holdRate}x, gaps ${p.gapRate}x, ${p.segments.length} segs, ${p.fx.length} fx, ${p.captions.length} caps, vo ${Object.keys(p.voAnchor).join(",")}`);
}
// Command montage: autopilot, then the short loadout edit.
type P = NonNullable<ReturnType<typeof plan>>;
const ap = edl.autopilot as P | undefined;
const lo = edl.loadout as P | undefined;
if (!ap) delete edl.command;
if (ap) {
  const off = ap.seconds;
  edl.command = {
    id: "command",
    src: ap.src,
    segments: [...ap.segments, ...(lo?.segments ?? [])],
    captions: [...ap.captions, ...(lo?.captions ?? []).map((c) => ({ ...c, at: round(c.at + off, 2) }))],
    fx: [...ap.fx, ...(lo?.fx ?? []).map((x) => ({ ...x, at: round(x.at + off, 2) }))],
    events: [...ap.events, ...(lo?.events ?? []).map((e) => ({ ...e, at: round(e.at + off, 2) }))],
    sfx: [...ap.sfx, ...(lo?.sfx ?? []).map((x) => ({ ...x, at: round(x.at + off, 2) }))],
    voSwap: {},
    voAnchor: { ...ap.voAnchor, ...Object.fromEntries(Object.entries(lo?.voAnchor ?? {}).map(([k, v]) => [k, round(v + off, 2)])) },
    seconds: round(off + (lo?.seconds ?? 0), 2),
  };
  console.log(`command: ${(edl.command as P).seconds}s (autopilot ${off}s + loadout ${lo?.seconds ?? 0}s)`);
}

// Hero: 2 s of busy gameplay, starting just before its first recall beam when marked.
const heroExt = ["mp4", "webm"].find((x) => existsSync(join(dir, `hero.${x}`)));
if (heroExt) {
  const hm = join(dir, "hero.markers.json");
  const doc = existsSync(hm) ? JSON.parse(readFileSync(hm, "utf8")) : { duration: 4, events: [] };
  const beam = (doc.events as Ev[]).find((e) => e.name === "recall_beam");
  const from = round(Math.min(Math.max(0.3, beam ? beam.t - 0.6 : 0.5), Math.max(0.3, doc.duration - 2.1)));
  edl.hero = { src: `clips/hero.${heroExt}`, from };
  console.log(`hero: from ${from}s`);
} else delete edl.hero;
writeFileSync(edlPath, JSON.stringify(edl, null, 2) + "\n");
console.log(`wrote ${edlPath}`);
