// Commander: a proposer (POST /propose, Proposer API) that learns from the user's vetoes.
// A small logistic model over (unit, target) features, starting from the autopilot heuristic's weights and
// refit from data/vetoes.jsonl whenever the log changes: go/expired = accepted, cancel = rejected,
// adjust = original rejected and the adjusted pair accepted. L2 pulls weights toward the prior, so a few
// vetoes nudge it and a consistent habit (e.g. "never send scouts to billing") takes over.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

type Pos = { x: number; y: number };
interface PUnit { id: string; class?: string; team?: number | null; status?: string; pos?: Pos; history?: Array<{ targetId?: string; component?: string } | string> }
interface PTarget { id: string; component?: string; severity?: number; kind?: string; status?: string; pos?: Pos }
interface Ctx { units?: PUnit[]; targets?: PTarget[]; memory?: string }
interface VetoRow { proposal?: { unitId?: string; targetId?: string }; context?: Ctx; action?: string; adjustedTo?: { unitId?: string; targetId?: string } }

const VETO_LOG = process.env.VETO_LOG ?? resolve(import.meta.dir, "../../../data/vetoes.jsonl");
const PRIOR: Record<string, number> = { sev: 3.0, knows: 0.6, mem: 0.2, dist: -1.2 };
const LAMBDA = 0.5;

const cheb = (a?: Pos, b?: Pos) => (a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 12);

function known(u: PUnit, targets: PTarget[]): Set<string> {
  const byId = new Map(targets.map((t) => [t.id, t.component]));
  const out = new Set<string>();
  for (const h of Array.isArray(u.history) ? u.history : []) {
    if (typeof h === "string") { out.add(byId.get(h) ?? h); continue; }
    if (h?.component) out.add(h.component);
    else if (h?.targetId && byId.get(h.targetId)) out.add(byId.get(h.targetId)!);
  }
  return out;
}

function features(u: PUnit, t: PTarget, ctx: Ctx): Record<string, number> {
  const comp = t.component ?? "unknown", cls = u.class ?? "unit", kind = t.kind ?? "issue";
  const f: Record<string, number> = {
    sev: (Number(t.severity) || 1) / 3,
    knows: known(u, ctx.targets ?? []).has(comp) ? 1 : 0,
    mem: (ctx.memory ?? "").toLowerCase().includes(comp.toLowerCase()) ? 1 : 0,
    dist: cheb(u.pos, t.pos) / 24,
  };
  f[`comp:${comp}`] = 1;
  f[`cls:${cls}|kind:${kind}`] = 1;
  f[`cls:${cls}|comp:${comp}`] = 1;
  return f;
}

const dot = (w: Record<string, number>, f: Record<string, number>) => Object.entries(f).reduce((s, [k, v]) => s + (w[k] ?? 0) * v, 0);
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

let cache = { mtime: -1, size: -1, rows: 0, examples: 0, w: { ...PRIOR } as Record<string, number>, trainedAt: 0 };

function examplesFrom(rows: VetoRow[]): Array<{ f: Record<string, number>; y: number }> {
  const out: Array<{ f: Record<string, number>; y: number }> = [];
  for (const r of rows) {
    const ctx = r.context ?? {};
    const find = (uid?: string, tid?: string) => {
      const u = ctx.units?.find((x) => x.id === uid), t = ctx.targets?.find((x) => x.id === tid);
      return u && t ? features(u, t, ctx) : null;
    };
    const orig = find(r.proposal?.unitId, r.proposal?.targetId);
    if (r.action === "go" || r.action === "expired") { if (orig) out.push({ f: orig, y: 1 }); }
    else if (r.action === "cancel") { if (orig) out.push({ f: orig, y: 0 }); }
    else if (r.action === "adjust") {
      if (orig) out.push({ f: orig, y: 0 });
      const adj = find(r.adjustedTo?.unitId ?? r.proposal?.unitId, r.adjustedTo?.targetId ?? r.proposal?.targetId);
      if (adj) out.push({ f: adj, y: 1 });
    }
  }
  return out;
}

function fit(ex: Array<{ f: Record<string, number>; y: number }>): Record<string, number> {
  const w: Record<string, number> = { ...PRIOR };
  if (!ex.length) return w;
  for (let it = 0; it < 300; it++) {
    const g: Record<string, number> = {};
    for (const { f, y } of ex) {
      const err = sigmoid(dot(w, f)) - y;
      for (const [k, v] of Object.entries(f)) g[k] = (g[k] ?? 0) + err * v;
    }
    const keys = new Set([...Object.keys(g), ...Object.keys(w)]);
    for (const k of keys) {
      const grad = (g[k] ?? 0) / ex.length + LAMBDA * ((w[k] ?? 0) - (PRIOR[k] ?? 0)) / ex.length;
      w[k] = (w[k] ?? 0) - 0.5 * grad;
    }
  }
  return w;
}

export function commanderModel() {
  if (!existsSync(VETO_LOG)) return cache;
  try {
    const st = statSync(VETO_LOG);
    if (st.mtimeMs === cache.mtime && st.size === cache.size) return cache;
    const rows = readFileSync(VETO_LOG, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as VetoRow; } catch { return null; } }).filter(Boolean) as VetoRow[];
    const ex = examplesFrom(rows);
    cache = { mtime: st.mtimeMs, size: st.size, rows: rows.length, examples: ex.length, w: fit(ex), trainedAt: Date.now() };
    console.log(`[forge] commander refit on ${rows.length} veto rows (${ex.length} examples)`);
  } catch (e) { console.error("[forge] commander fit failed", e); }
  return cache;
}

export function propose(req: Ctx): Array<{ unitId: string; targetId: string; reason: string }> {
  const m = commanderModel();
  const units = (req.units ?? []).filter((u) => u?.id && (u.status ?? "idle") === "idle");
  const targets = (req.targets ?? []).filter((t) => t?.id && (t.status ?? "open") === "open");
  const pairs = units.flatMap((u) => targets.map((t) => { const f = features(u, t, req); return { u, t, f, z: dot(m.w, f) }; }));
  pairs.sort((a, b) => b.z - a.z || a.u.id.localeCompare(b.u.id) || a.t.id.localeCompare(b.t.id));
  const usedU = new Set<string>(), usedT = new Set<string>();
  const out: Array<{ unitId: string; targetId: string; reason: string }> = [];
  for (const p of pairs) {
    if (usedU.has(p.u.id) || usedT.has(p.t.id)) continue;
    // Once it has learned from enough vetoes, the commander holds back pairs the user keeps rejecting.
    if (m.examples >= 5 && sigmoid(p.z) < 0.25) continue;
    usedU.add(p.u.id); usedT.add(p.t.id);
    const top = Object.entries(p.f).map(([k, v]) => [k, (m.w[k] ?? 0) * v] as const).filter(([, c]) => Math.abs(c) > 0.05)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3).map(([k, c]) => `${k} ${c > 0 ? "+" : ""}${c.toFixed(2)}`);
    out.push({ unitId: p.u.id, targetId: p.t.id,
      reason: `commander (${m.examples ? `learned from ${m.examples} veto decisions` : "prior, no vetoes yet"}), p=${sigmoid(p.z).toFixed(2)}: ${top.join(", ")}` });
  }
  return out;
}
