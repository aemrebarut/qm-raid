// Heuristic proposer (Proposer API in docs/CONTRACT.md). Pure: no I/O.
import type { Pos, Proposal } from "../../../contract/types.ts";

export interface PUnit { id: string; class?: string; team?: number | null; status?: string; pos?: Pos; history?: Array<{ targetId?: string; component?: string } | string> }
export interface PTarget { id: string; component?: string; severity?: number; kind?: string; status?: string; pos?: Pos; customers?: string[] }
export interface ProposeRequest { units?: PUnit[]; targets?: PTarget[]; memory?: string }

const W = { severity: 10, knows: 6, memory: 2, distance: 0.5 };

const cheb = (a?: Pos, b?: Pos) => (a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : 12);

function knownComponents(u: PUnit, targets: PTarget[]): Set<string> {
  const byId = new Map(targets.map((t) => [t.id, t.component]));
  const out = new Set<string>();
  for (const h of Array.isArray(u.history) ? u.history : []) {
    if (typeof h === "string") { out.add(byId.get(h) ?? h); continue; } // a targetId or a component id
    if (h?.component) out.add(h.component);
    else if (h?.targetId && byId.get(h.targetId)) out.add(byId.get(h.targetId)!);
  }
  return out;
}

export function propose(req: ProposeRequest): Proposal[] {
  const units = (Array.isArray(req?.units) ? req.units : []).filter((u) => u && typeof u.id === "string" && (u.status ?? "idle") === "idle");
  const targets = (Array.isArray(req?.targets) ? req.targets : []).filter((t) => t && typeof t.id === "string" && (t.status ?? "open") === "open");
  const memory = typeof req?.memory === "string" ? req.memory.toLowerCase() : "";

  const pairs: Array<{ u: PUnit; t: PTarget; score: number; dist: number; knows: boolean; mem: boolean }> = [];
  for (const u of units) {
    const known = knownComponents(u, targets);
    for (const t of targets) {
      const sev = Number(t.severity) || 1;
      const knows = !!t.component && known.has(t.component);
      const mem = !!t.component && memory.includes(t.component.toLowerCase());
      const dist = cheb(u.pos, t.pos);
      pairs.push({ u, t, dist, knows, mem, score: sev * W.severity + (knows ? W.knows : 0) + (mem ? W.memory : 0) - dist * W.distance });
    }
  }
  // greedy: best pair first; ties by lower unit id, then lower target id
  pairs.sort((a, b) => b.score - a.score || a.u.id.localeCompare(b.u.id, undefined, { numeric: true }) || a.t.id.localeCompare(b.t.id, undefined, { numeric: true }));

  const usedU = new Set<string>(), usedT = new Set<string>();
  const out: Proposal[] = [];
  for (const p of pairs) {
    if (usedU.has(p.u.id) || usedT.has(p.t.id)) continue;
    usedU.add(p.u.id); usedT.add(p.t.id);
    const bits = [`severity ${Number(p.t.severity) || 1} ${p.t.kind ?? "issue"} in ${p.t.component ?? "an unknown component"}`, `${p.dist} tile${p.dist === 1 ? "" : "s"} away`];
    if (p.knows) bits.push(`knows ${p.t.component}`);
    if (p.mem) bits.push(`recent memory mentions ${p.t.component}`);
    out.push({ unitId: p.u.id, targetId: p.t.id, reason: bits.join(", ") });
  }
  return out;
}
