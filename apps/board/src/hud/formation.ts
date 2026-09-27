// Formation (side panel, team view): the team's workflow as a preset picker, role slots bound to
// members, a node-link diagram with live per-node state, and the current run's steps.
// Persistent like the Barracks: each part rebuilds only when its signature changes, so an open
// dropdown or a button under the cursor survives the frequent state renders.
import { api, type Bus, type State, type Store, type Team, type Unit, type Workflow, type WorkflowRun, type WorkflowStep } from "../core";
import { clear, h, put, safeColor, timeOf } from "./dom";
import { classGlyph } from "./sidePanel";

type Preset = Exclude<Workflow["preset"], "custom">;
export type NodeState = "idle" | "active" | "done" | "approved" | "changes" | "failed";

export const PRESETS: { id: Preset; label: string; need: number; title: string }[] = [
  { id: "solo", label: "Solo", need: 1, title: "One implementer does it all" },
  { id: "pair", label: "Pair", need: 2, title: "Implementer, then a reviewer who can send it back" },
  { id: "trio", label: "Trio", need: 3, title: "Planner, implementer, reviewer (changes loop back)" },
  { id: "fanout", label: "Fan-out", need: 3, title: "Planner, every middle member implements in parallel, reviewer waits for all" },
];

const SVG = "http://www.w3.org/2000/svg";
const VW = 280; // diagram viewBox width
const COL_GAP = 20;
const ROW_H = 46;
const R = 14;
const STEPS_SHOWN = 6;

/** Latest state of each node in a run (active wins). */
export function nodeStates(run: WorkflowRun | undefined): Map<string, NodeState> {
  const m = new Map<string, NodeState>();
  if (!run) return m;
  for (const st of run.steps) m.set(st.nodeId, st.status);
  for (const id of run.active) m.set(id, "active");
  return m;
}

/** Nodes in columns by distance from the entry along forward edges (changes edges loop back). */
export function columns(wf: Workflow): string[][] {
  const depth = new Map<string, number>([[wf.entry, 0]]);
  const queue = [wf.entry];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of wf.edges) {
      if (e.from !== id || e.on === "changes" || depth.has(e.to)) continue;
      depth.set(e.to, depth.get(id)! + 1);
      queue.push(e.to);
    }
  }
  const max = Math.max(0, ...depth.values());
  const cols: string[][] = [];
  for (const n of wf.nodes) {
    const d = depth.get(n.id) ?? max + 1; // unreachable nodes go last
    (cols[d] ??= []).push(n.id);
  }
  return cols.filter(Boolean);
}

export function teamOfSelection(s: State, unitIds: string[]): Team | undefined {
  if (!unitIds.length) return undefined;
  const ids = new Set(unitIds);
  return s.teams.find((t) => t.members.length === ids.size && t.members.every((m) => ids.has(m)));
}

export function roleOf(team: Team | undefined, unitId: string): string | undefined {
  return team?.workflow?.nodes.filter((n) => n.unitId === unitId).map((n) => n.role).join(", ") || undefined;
}

export class FormationPanel {
  private presets = h("div", { class: "hud-wf-presets", role: "group", "aria-label": "Formation preset" });
  private slots = h("div", { class: "hud-wf-slots" });
  private diagram = h("div", { class: "hud-wf-diagram" });
  private run = h("div", { class: "hud-wf-run" });
  readonly root = h("section", { class: "hud-section hud-wf", hidden: true },
    h("h3", null, "Formation"), this.presets, this.slots, this.diagram, this.run);
  private teamId: number | null = null;
  private sigs = { presets: "", slots: "", diagram: "", run: "" };

  constructor(private store: Store, private bus: Bus) {}

  setState(s: State, team: Team): void {
    if (team.id !== this.teamId) this.sigs = { presets: "", slots: "", diagram: "", run: "" };
    this.teamId = team.id;
    const wf = team.workflow;
    const run = this.store.run(team.id);
    const members = team.members.map((id) => s.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    this.renderPresets(team, wf, members.length);
    this.renderSlots(team, wf, members);
    this.renderDiagram(s, team, wf, run);
    this.renderRun(s, team, wf, run);
  }

  private renderPresets(team: Team, wf: Workflow | null, count: number): void {
    const sig = `${team.id}:${wf?.preset ?? "off"}:${count}`;
    if (sig === this.sigs.presets) return;
    this.sigs.presets = sig;
    clear(this.presets);
    const teamId = team.id;
    for (const p of PRESETS) {
      const short = count < p.need;
      this.presets.append(h("button", {
        class: "hud-btn hud-btn-sm hud-wf-preset", type: "button", "data-on": String(wf?.preset === p.id), disabled: short,
        title: short ? `${p.label} needs ${p.need} members` : p.title,
        onclick: () => void this.setPreset(teamId, p.id, p.label),
      }, p.label));
    }
    if (wf?.preset === "custom") this.presets.append(h("span", { class: "hud-btn hud-btn-sm hud-wf-preset", "data-on": "true" }, "Custom"));
    this.presets.append(h("button", {
      class: "hud-btn hud-btn-sm hud-wf-preset hud-wf-off", type: "button", "data-on": String(!wf), disabled: !wf,
      title: "No formation: members take orders one by one", onclick: () => void this.clearPreset(teamId),
    }, "Off"));
  }

  private renderSlots(team: Team, wf: Workflow | null, members: Unit[]): void {
    const sig = `${team.id}:${wf ? wf.nodes.map((n) => `${n.id}=${n.role}=${n.unitId}`).join(",") : "-"}:${members.map((u) => `${u.id}=${u.name}`).join(",")}`;
    if (sig === this.sigs.slots) return;
    this.sigs.slots = sig;
    clear(this.slots);
    if (!wf) {
      this.slots.append(h("p", { class: "hud-hint" }, "Pick a formation and the team works one issue together: the plan, the fix and the review pass from unit to unit."));
      return;
    }
    const teamId = team.id;
    for (const n of wf.nodes) {
      const nodeId = n.id;
      const pick = h("select", { class: "hud-select", title: `Who plays ${n.role}` },
        members.map((u) => h("option", { value: u.id }, `${u.name} (${u.class})`)));
      if (!members.some((u) => u.id === n.unitId)) pick.append(h("option", { value: n.unitId }, `${n.unitId} (gone)`));
      pick.value = n.unitId;
      pick.addEventListener("change", () => void this.assign(teamId, nodeId, pick.value));
      pick.addEventListener("keydown", (e) => e.stopPropagation()); // arrow keys pick, never pan the camera
      this.slots.append(h("label", { class: "hud-wf-slot" }, h("span", { class: "hud-wf-role" }, cap(n.role)), pick));
    }
  }

  private renderDiagram(s: State, team: Team, wf: Workflow | null, run: WorkflowRun | undefined): void {
    const states = nodeStates(run);
    const sig = wf
      ? `${team.color}|${JSON.stringify(wf.edges)}|${wf.entry}|${wf.nodes.map((n) => `${n.id}:${n.role}:${n.unitId}:${s.units.find((u) => u.id === n.unitId)?.class}:${states.get(n.id) ?? "idle"}`).join(",")}`
      : "-";
    if (sig === this.sigs.diagram) return;
    this.sigs.diagram = sig;
    clear(this.diagram);
    this.diagram.hidden = !wf;
    if (wf) this.diagram.append(this.svg(s, team, wf, states));
  }

  private svg(s: State, team: Team, wf: Workflow, states: Map<string, NodeState>): SVGElement {
    const cols = columns(wf);
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const hasBack = wf.edges.some((e) => e.on === "changes");
    const H = rows * ROW_H + (hasBack ? 34 : 8);
    const colW = (VW - 2 * COL_GAP) / Math.max(1, cols.length);
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((col, ci) => col.forEach((id, ri) => {
      const x = COL_GAP + colW * (ci + 0.5);
      const y = 8 + R + ((rows - col.length) * ROW_H) / 2 + ri * ROW_H;
      pos.set(id, { x, y });
    }));

    const svg = el("svg", { viewBox: `0 0 ${VW} ${H}`, class: "hud-wf-svg", role: "img", "aria-label": `${team.name} formation` });
    for (const e of wf.edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const back = e.on === "changes" || b.x < a.x || (b.x === a.x && b.y <= a.y);
      const cls = `hud-wf-edge hud-wf-edge-${e.on}`;
      if (back) {
        // Loop back under the nodes: a curve from the bottom of `from` to the bottom of `to`.
        const y0 = Math.max(a.y, b.y) + R;
        const dip = y0 + 18;
        const d = `M ${a.x} ${a.y + R} C ${a.x} ${dip}, ${b.x} ${dip}, ${b.x} ${b.y + R + 2}`;
        svg.append(el("path", { d, class: cls }), arrow(b.x, b.y + R + 1, -Math.PI / 2, cls));
        if (e.on === "changes") svg.append(label((a.x + b.x) / 2, dip + 7, "changes", "hud-wf-edge-label"));
      } else {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const [x1, y1] = [a.x + Math.cos(ang) * R, a.y + Math.sin(ang) * R];
        const [x2, y2] = [b.x - Math.cos(ang) * (R + 1), b.y - Math.sin(ang) * (R + 1)];
        svg.append(el("line", { x1, y1, x2, y2, class: cls }), arrow(x2, y2, ang, cls));
      }
    }
    for (const n of wf.nodes) {
      const p = pos.get(n.id);
      if (!p) continue;
      const u = s.units.find((x) => x.id === n.unitId);
      const state = states.get(n.id) ?? "idle";
      const unitId = n.unitId;
      const g = el("g", { class: "hud-wf-node", "data-state": state, "data-node": n.id, transform: `translate(${p.x} ${p.y})`, style: `--team:${safeColor(team.color)}` });
      const title = el("title");
      title.textContent = `${cap(n.role)}: ${u?.name ?? n.unitId} (${state}). Click to select.`;
      const glyph = label(0, 5, u ? classGlyph(u.class) : "?", "hud-wf-glyph");
      g.append(title, el("circle", { r: R + 4, class: "hud-wf-halo" }), el("circle", { r: R, class: "hud-wf-disc" }), glyph,
        label(0, R + 11, cap(n.role), "hud-wf-role-label"), badge(state));
      g.addEventListener("click", () => this.bus.select([unitId]));
      g.addEventListener("mouseenter", () => this.bus.hover({ kind: "unit", id: unitId }));
      g.addEventListener("mouseleave", () => this.bus.hover(null));
      svg.append(g);
    }
    return svg;
  }

  private renderRun(s: State, team: Team, wf: Workflow | null, run: WorkflowRun | undefined): void {
    const last = run?.steps.at(-1);
    const sig = run ? `${run.id}:${run.status}:${run.loops}:${run.steps.length}:${last?.status}:${last?.summary}:${wf?.maxLoops}` : `none:${!!wf}`;
    if (sig === this.sigs.run) return;
    this.sigs.run = sig;
    clear(this.run);
    if (!run) {
      if (wf) this.run.append(h("p", { class: "hud-hint" }, "With the whole team selected, right-click a camp to start a run."));
      return;
    }
    const t = s.targets.find((x) => x.id === run.targetId);
    const active = activeStep(run);
    put(this.run,
      h("div", { class: "hud-wf-run-head" },
        h("span", { class: "hud-wf-run-title" }, t ? `${t.issue}: ${t.title}` : run.targetId),
        h("span", { class: `hud-pill hud-run-${run.status}` }, run.status.replace("_", " "))),
      h("div", { class: "hud-sub" }, `loop ${run.loops} of ${wf?.maxLoops ?? "?"} · ${run.steps.length} step${run.steps.length === 1 ? "" : "s"}`),
      h("ol", { class: "hud-wf-steps" }, run.steps.slice(-STEPS_SHOWN).map((st) => stepRow(s, wf, st))),
      run.status === "running" && active
        ? h("div", { class: "hud-card-btns" }, h("button", {
            class: "hud-btn hud-btn-sm hud-btn-cancel", type: "button", title: "Cancel the run (cancels its active order)",
            onclick: () => void this.cancel(active.orderId),
          }, "Cancel run"))
        : null,
    );
  }

  private async setPreset(teamId: number, preset: Preset, label: string): Promise<void> {
    const r = await api.setWorkflow(teamId, { preset });
    this.bus.toast(r.ok ? `Formation: ${label}` : r.error, r.ok ? "info" : "error");
  }

  private async clearPreset(teamId: number): Promise<void> {
    const r = await api.clearWorkflow(teamId);
    this.bus.toast(r.ok ? "Formation off" : r.error, r.ok ? "info" : "error");
  }

  // Rebind one role to another member; the rest of the graph is sent back unchanged.
  private async assign(teamId: number, nodeId: string, unitId: string): Promise<void> {
    const wf = this.store.team(teamId)?.workflow;
    if (!wf) return;
    const workflow: Workflow = { ...wf, nodes: wf.nodes.map((n) => (n.id === nodeId ? { ...n, unitId } : n)) };
    const r = await api.setWorkflow(teamId, { workflow });
    const who = this.store.unit(unitId)?.name ?? unitId;
    this.bus.toast(r.ok ? `${who} is now ${wf.nodes.find((n) => n.id === nodeId)?.role ?? nodeId}` : r.error, r.ok ? "info" : "error");
    if (!r.ok) { this.sigs.slots = ""; const t = this.store.team(teamId); if (t) this.setState(this.store.getState(), t); } // put the select back
  }

  private async cancel(orderId: string): Promise<void> {
    const r = await api.cancelOrder(orderId);
    this.bus.toast(r.ok ? "Run cancelled" : r.error, r.ok ? "info" : "error");
  }
}

export function activeStep(run: WorkflowRun): WorkflowStep | undefined {
  return [...run.steps].reverse().find((st) => st.status === "active");
}

function stepRow(s: State, wf: Workflow | null, st: WorkflowStep): HTMLElement {
  const role = wf?.nodes.find((n) => n.id === st.nodeId)?.role ?? st.nodeId;
  const who = s.units.find((u) => u.id === st.unitId)?.name ?? st.unitId;
  return h("li", { class: "hud-wf-step", "data-state": st.status },
    h("span", { class: "hud-feed-time" }, timeOf(st.ts)),
    h("span", { class: "hud-wf-step-mark" }, MARK[st.status] ?? "•"),
    h("span", { class: "hud-wf-step-text" }, h("b", null, `${cap(role)} ${who}`), st.summary ? `: ${st.summary}` : st.status === "active" ? ": working..." : ""),
  );
}

const MARK: Record<string, string> = { active: "●", done: "✓", approved: "✔", changes: "↺", failed: "✖" };

function badge(state: NodeState): SVGElement {
  const g = el("g", { class: "hud-wf-badge", transform: `translate(${R - 2} ${-R + 2})` });
  if (state === "idle") return g;
  g.append(el("circle", { r: 6 }), label(0, 3.5, MARK[state] ?? "", ""));
  return g;
}

function arrow(x: number, y: number, ang: number, cls: string): SVGElement {
  const s = 5;
  const p = (a: number) => `${x - Math.cos(ang + a) * s},${y - Math.sin(ang + a) * s}`;
  return el("polygon", { points: `${x},${y} ${p(0.5)} ${p(-0.5)}`, class: `${cls} hud-wf-arrow` });
}

function label(x: number, y: number, text: string, cls: string): SVGElement {
  const t = el("text", { x, y, class: cls, "text-anchor": "middle" });
  t.textContent = text;
  return t;
}

function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
