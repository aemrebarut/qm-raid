// Formation (side panel): how a team works one issue together.
// Flow: select 2+ units -> "Form team" (or the F command, openFormation) makes them the next free group ->
// preset cards (diagram thumbnail, name, purpose) -> role slots with portraits (click a slot, then a unit on
// the map or on the bench; or drag portraits) -> right-click a camp to start -> live diagram and steps.
// Self-driving: renders from the store and bus.selection, and owns its own visibility. Each part rebuilds
// only when its signature changes, so a button under the cursor or a drag in progress survives renders.
import { api, assignRole, formTeam, type Bus, type State, type Store, type Team, type Unit, type Workflow, type WorkflowNode, type WorkflowRun, type WorkflowStep } from "../core";
import { classIcon, icon } from "../theme/icons";
import { ago, clear, h, put, safeColor } from "./dom";

type Preset = Exclude<Workflow["preset"], "custom">;
export type NodeState = "idle" | "active" | "done" | "approved" | "changes" | "failed";

const n = (id: string, role: string): WorkflowNode => ({ id, role, unitId: "" });
const e = (from: string, to: string, on: "done" | "approved" | "changes" = "done") => ({ from, to, on });
const line3 = (preset: Preset, first: string): Workflow => ({
  preset, entry: "a", maxLoops: 2, nodes: [n("a", first), n("i", "implementer"), n("r", "reviewer")], edges: [e("a", "i"), e("i", "r"), e("r", "i", "changes")],
});
export const PRESETS: { id: Preset; label: string; need: number; purpose: string; shape: Workflow }[] = [
  { id: "solo", label: "Solo", need: 1, purpose: "One agent does it all",
    shape: { preset: "solo", entry: "i", maxLoops: 0, nodes: [n("i", "implementer")], edges: [] } },
  { id: "pair", label: "Pair", need: 2, purpose: "Build, then review",
    shape: { preset: "pair", entry: "i", maxLoops: 2, nodes: [n("i", "implementer"), n("r", "reviewer")], edges: [e("i", "r"), e("r", "i", "changes")] } },
  { id: "trio", label: "Trio", need: 3, purpose: "Plan, build, review",
    shape: { preset: "trio", entry: "p", maxLoops: 2, nodes: [n("p", "planner"), n("i", "implementer"), n("r", "reviewer")], edges: [e("p", "i"), e("i", "r"), e("r", "i", "changes")] } },
  { id: "fanout", label: "Fan-out", need: 3, purpose: "Plan, build in parallel, review",
    shape: { preset: "fanout", entry: "p", maxLoops: 2, nodes: [n("p", "planner"), n("a", "implementer"), n("b", "implementer"), n("r", "reviewer")],
      edges: [e("p", "a"), e("p", "b"), e("a", "r"), e("b", "r")] } },
  { id: "recon", label: "Recon", need: 3, purpose: "Scout, build, review", shape: line3("recon", "scout") },
  { id: "testfirst", label: "Test first", need: 3, purpose: "Failing test, fix, review", shape: line3("testfirst", "tester") },
  { id: "herald", label: "Herald", need: 3, purpose: "Fix, review, tell customers",
    shape: { preset: "herald", entry: "i", maxLoops: 2, nodes: [n("i", "implementer"), n("r", "reviewer"), n("h", "herald")],
      edges: [e("i", "r"), e("r", "h", "approved"), e("r", "i", "changes")] } },
  { id: "duel", label: "Duel", need: 3, purpose: "Two fixes, a judge picks", 
    shape: { preset: "duel", entry: "a", entries: ["a", "b"], maxLoops: 2, nodes: [n("a", "implementer"), n("b", "implementer"), n("j", "judge")],
      edges: [e("a", "j"), e("b", "j")] } },
];

const SVG = "http://www.w3.org/2000/svg";
const STEPS_SHOWN = 6;
const DND = "application/x-raid-unit";

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
  const starts = wf.entries?.length ? wf.entries : [wf.entry]; // parallel starts (duel) share column 0
  const depth = new Map<string, number>(starts.map((id) => [id, 0]));
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    for (const ed of wf.edges) {
      if (ed.from !== id || ed.on === "changes" || depth.has(ed.to)) continue;
      depth.set(ed.to, depth.get(id)! + 1);
      queue.push(ed.to);
    }
  }
  const max = Math.max(0, ...depth.values());
  const cols: string[][] = [];
  for (const nd of wf.nodes) (cols[depth.get(nd.id) ?? max + 1] ??= []).push(nd.id); // unreachable nodes go last
  return cols.filter(Boolean);
}

export function teamOfSelection(s: State, unitIds: string[]): Team | undefined {
  if (!unitIds.length) return undefined;
  const ids = new Set(unitIds);
  return s.teams.find((t) => t.members.length === ids.size && t.members.every((m) => ids.has(m)));
}

export function roleOf(team: Team | undefined, unitId: string): string | undefined {
  return team?.workflow?.nodes.filter((nd) => nd.unitId === unitId).map((nd) => nd.role).join(", ") || undefined;
}

export function activeStep(run: WorkflowRun): WorkflowStep | undefined {
  return [...run.steps].reverse().find((st) => st.status === "active");
}

let reveal = false; // set by openFormation: scroll the panel into view once it shows the team

/** The group formTeam would use: the exact existing team, else the lowest group without members (1..9). */
export function freeTeamId(s: State, unitIds: string[]): number | null {
  const same = teamOfSelection(s, unitIds);
  if (same) return same.id;
  for (let i = 1; i <= 9; i++) if (!s.teams.some((t) => t.id === i && t.members.length)) return i;
  return null;
}

/** Formation command (side panel button, command card F): make the units one team if they are not, then show its formation. */
export async function openFormation(store: Store, bus: Bus, unitIds: string[] = bus.selection.units): Promise<number | null> {
  if (unitIds.length < 2) { bus.toast("Select two or more units", "error"); return null; }
  reveal = true;
  const id = await formTeam(store, bus, unitIds);
  if (id == null) reveal = false;
  return id;
}

export class FormationPanel {
  private entry = h("div", { class: "hud-wf-entry" });
  private presets = h("div", { class: "hud-wf-presets" });
  private slots = h("div", { class: "hud-wf-slots" });
  private cue = h("div", { class: "hud-wf-cue" }, mouseIcon(), h("span", null, "Right-click a camp to start"));
  private diagram = h("div", { class: "hud-wf-diagram" });
  private run = h("div", { class: "hud-wf-run" });
  readonly root = h("section", { class: "hud-section hud-wf", hidden: true },
    h("h3", { title: "Team workflow: work passes from unit to unit (plan, build, review)" }, "Formation"),
    this.entry, this.presets, this.slots, this.cue, this.diagram, this.run);
  private teamId: number | null = null;
  private visible = false;
  private sigs = { entry: "", presets: "", slots: "", diagram: "", run: "" };

  constructor(private store: Store, private bus: Bus) {
    store.subscribe(() => this.update());
    bus.on("selection", () => this.update());
    bus.on("command", () => this.update()); // a role slot waiting for a unit click
    // The side panel also toggles `hidden` on its render; keep the visibility this panel decided.
    new MutationObserver(() => { if (this.root.hidden === this.visible) this.root.hidden = !this.visible; })
      .observe(this.root, { attributes: true, attributeFilter: ["hidden"] });
  }

  /** Compatible with the side panel hook; the panel renders itself from the store and selection. */
  setState(_s?: State, _team?: Team): void {
    this.update();
  }

  update(): void {
    const s = this.store.getState();
    const sel = this.bus.selection;
    const units = sel.focus === "units" ? sel.units.filter((id) => s.units.some((u) => u.id === id)) : [];
    const team = teamOfSelection(s, units);
    this.visible = !!team || units.length >= 2;
    this.root.hidden = !this.visible;
    this.root.dataset.mode = team ? "team" : "entry";
    if (!this.visible) return;
    if (!team) return this.renderEntry(s, units);
    this.entry.hidden = true;
    if (team.id !== this.teamId) this.sigs = { entry: "", presets: "", slots: "", diagram: "", run: "" };
    this.teamId = team.id;
    const wf = team.workflow;
    const run = this.store.run(team.id);
    const members = team.members.map((id) => s.units.find((u) => u.id === id)).filter((u): u is Unit => !!u);
    this.renderPresets(team, wf, members.length);
    this.renderSlots(team, wf, members);
    this.cue.hidden = !wf || run?.status === "running";
    this.renderDiagram(s, team, wf, run);
    this.renderRun(s, team, wf, run);
    for (const t of this.run.querySelectorAll<HTMLElement>("[data-ts]")) t.textContent = ago(Number(t.dataset.ts));
    if (reveal) { reveal = false; this.root.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }
  }

  // Several units that are not one team: a single entry point.
  private renderEntry(s: State, units: string[]): void {
    for (const part of [this.presets, this.slots, this.cue, this.diagram, this.run]) part.hidden = true;
    this.entry.hidden = false;
    this.teamId = null;
    this.sigs.presets = this.sigs.slots = this.sigs.diagram = this.sigs.run = "";
    const id = freeTeamId(s, units);
    const sig = `${units.join(",")}:${id}`;
    if (sig === this.sigs.entry) return;
    this.sigs.entry = sig;
    const ids = [...units];
    clear(this.entry);
    put(this.entry,
      h("button", { class: "hud-btn hud-wf-form", type: "button", disabled: id == null,
        title: id == null ? "All nine groups are in use" : `Make these ${ids.length} units group ${id}, then pick how they work together (F)`,
        onclick: () => void openFormation(this.store, this.bus, ids) },
        icon("formation", 18), h("span", null, "Form team"), h("span", { class: "hud-wf-key" }, "F")),
      h("span", { class: "hud-sub" }, id == null ? "No free group" : `${ids.length} units as group ${id}`));
  }

  private renderPresets(team: Team, wf: Workflow | null, count: number): void {
    const sig = `${team.id}:${wf?.preset ?? "off"}:${count}:${team.color}`;
    if (sig === this.sigs.presets) return;
    this.sigs.presets = sig;
    clear(this.presets);
    this.presets.hidden = false;
    this.presets.dataset.big = String(!wf); // big cards until a formation is set, then a compact strip
    const teamId = team.id;
    for (const p of PRESETS) {
      const short = count < p.need;
      this.presets.append(h("button", {
        class: "hud-wf-card", type: "button", "data-on": String(wf?.preset === p.id), disabled: short,
        title: short ? `${p.label} needs ${p.need} units` : `${p.label}: ${p.purpose}`,
        onclick: () => void this.setPreset(teamId, p.id, p.label),
      }, graph(p.shape, { r: 6, rowH: 17, width: 96, color: team.color, face: (nd) => nd.role[0].toUpperCase(), thumb: true }),
        h("b", null, p.label), h("span", { class: "hud-wf-purpose" }, short ? `${p.need}+ units` : p.purpose)));
    }
    if (wf) {
      this.presets.append(h("button", { class: "hud-wf-card hud-wf-off", type: "button", title: "Disband the formation: members take orders one by one",
        onclick: () => void this.clearPreset(teamId) }, icon("close", 14), h("b", null, "Off")));
    }
  }

  /** The role slot waiting for a unit click (core completes it on the map; the bench completes it here). */
  private armed(teamId: number): string | null {
    const c = this.bus.command;
    return c?.kind === "role" && c.teamId === teamId ? c.nodeId : null;
  }

  private renderSlots(team: Team, wf: Workflow | null, members: Unit[]): void {
    const pending = this.armed(team.id);
    const sig = `${team.id}:${team.color}:${pending}:${wf ? wf.nodes.map((nd) => `${nd.id}=${nd.role}=${nd.unitId}`).join(",") : "-"}:${members.map((u) => `${u.id}=${u.name}=${u.class}`).join(",")}`;
    if (sig === this.sigs.slots) return;
    this.sigs.slots = sig;
    clear(this.slots);
    this.slots.hidden = !wf;
    if (!wf) return;
    const teamId = team.id;
    const color = safeColor(team.color);
    for (const nd of wf.nodes) {
      const nodeId = nd.id;
      const u = members.find((m) => m.id === nd.unitId);
      const armed = pending === nodeId;
      const slot = h("button", { class: "hud-wf-slot", type: "button", "data-node": nodeId, "data-armed": String(armed), style: `--team:${color}`,
        title: armed ? "Click a unit on the map or below, or click here to cancel" : `Click, then click a unit to make it the ${nd.role}. Or drag a portrait here.`,
        onclick: () => this.bus.setCommand(this.armed(teamId) === nodeId ? null : { kind: "role", teamId, nodeId }) },
        face(u, color, nodeId),
        h("span", { class: "hud-wf-slot-text" }, h("span", { class: "hud-wf-role" }, cap(nd.role)),
          h("span", { class: "hud-wf-who" }, armed ? "Pick a unit" : u?.name ?? `${nd.unitId} (gone)`)));
      slot.addEventListener("dragover", (ev) => { if (ev.dataTransfer?.types.includes(DND)) { ev.preventDefault(); slot.dataset.drop = "true"; } });
      slot.addEventListener("dragleave", () => delete slot.dataset.drop);
      slot.addEventListener("drop", (ev) => {
        ev.preventDefault();
        delete slot.dataset.drop;
        const [unitId, from] = (ev.dataTransfer?.getData(DND) ?? "").split("|"); // from: source slot (the holder swaps)
        if (unitId && from !== nodeId) void this.place(teamId, nodeId, unitId);
      });
      this.slots.append(slot);
    }
    // Bench: every member, to drag onto a slot or click while a slot is armed.
    this.slots.append(h("div", { class: "hud-wf-bench", title: "Drag a portrait onto a role" },
      members.map((u) => {
        const f = face(u, color);
        f.addEventListener("click", () => {
          const nodeId = this.armed(teamId);
          if (!nodeId) return;
          this.bus.setCommand(null);
          void this.place(teamId, nodeId, u.id);
        });
        return f;
      })));
  }

  private renderDiagram(s: State, team: Team, wf: Workflow | null, run: WorkflowRun | undefined): void {
    const states = nodeStates(run);
    const sig = wf
      ? `${team.color}|${JSON.stringify(wf.edges)}|${wf.entry}|${wf.nodes.map((nd) => `${nd.id}:${nd.role}:${nd.unitId}:${s.units.find((u) => u.id === nd.unitId)?.name}:${states.get(nd.id) ?? "idle"}`).join(",")}`
      : "-";
    if (sig === this.sigs.diagram) return;
    this.sigs.diagram = sig;
    clear(this.diagram);
    this.diagram.hidden = !wf;
    if (!wf) return;
    const unitName = (id: string) => s.units.find((u) => u.id === id)?.name ?? id;
    this.diagram.append(graph(wf, {
      r: 14, rowH: 46, width: 280, color: team.color, labels: true, aria: `${team.name} formation`,
      face: (nd) => initial(unitName(nd.unitId)),
      state: (nd) => states.get(nd.id) ?? "idle",
      title: (nd) => `${cap(nd.role)}: ${unitName(nd.unitId)} (${states.get(nd.id) ?? "waiting"}). Click to select.`,
      onNode: (nd) => this.bus.select([nd.unitId]),
      hover: (nd) => this.bus.hover(nd ? { kind: "unit", id: nd.unitId } : null),
    }));
  }

  private renderRun(s: State, team: Team, wf: Workflow | null, run: WorkflowRun | undefined): void {
    // Every shown row counts: in a fan-out an earlier branch can finish while the last one is still active.
    const t = run ? s.targets.find((x) => x.id === run.targetId) : undefined;
    const sig = run
      ? JSON.stringify([run.id, run.status, run.loops, run.steps.length, wf?.maxLoops, t?.issue, t?.title, wf?.nodes.map((nd) => [nd.id, nd.role]),
          run.steps.slice(-STEPS_SHOWN).map((st) => [st.nodeId, st.unitId, st.orderId, st.status, st.summary, st.ts, s.units.find((u) => u.id === st.unitId)?.name])])
      : "none";
    if (sig === this.sigs.run) return;
    this.sigs.run = sig;
    clear(this.run);
    this.run.hidden = !run;
    if (!run) return;
    const active = activeStep(run);
    put(this.run,
      h("div", { class: "hud-wf-run-head" },
        h("span", { class: "hud-wf-run-title" }, t ? `${t.issue} ${t.title}` : run.targetId),
        h("span", { class: `hud-pill hud-run-${run.status}` }, STATUS[run.status] ?? run.status)),
      h("div", { class: "hud-sub" }, `Loop ${run.loops}/${wf?.maxLoops ?? "?"}`),
      h("ol", { class: "hud-wf-steps" }, run.steps.slice(-STEPS_SHOWN).map((st) => stepRow(s, wf, st))),
      run.status === "running" && active
        ? h("div", { class: "hud-card-btns" }, h("button", {
            class: "hud-btn hud-btn-sm hud-btn-cancel", type: "button", title: "Cancel the run (stops its active order)",
            onclick: () => void this.cancel(active.orderId),
          }, "Cancel"))
        : null,
    );
  }

  // Drag and drop or a bench click: core joins an outsider to the team and swaps with the current holder.
  private async place(teamId: number, nodeId: string, unitId: string): Promise<void> {
    const r = await assignRole(this.store, this.bus, teamId, nodeId, unitId);
    // Put the slot back, but only if this team is still the one shown (the user may have moved on).
    if (r && !r.ok && teamId === this.teamId && this.visible) { this.sigs.slots = ""; this.update(); }
  }

  private async setPreset(teamId: number, preset: Preset, label: string): Promise<void> {
    const r = await api.setWorkflow(teamId, { preset });
    this.bus.toast(r.ok ? `Formation: ${label}` : r.error, r.ok ? "info" : "error");
  }

  private async clearPreset(teamId: number): Promise<void> {
    const r = await api.clearWorkflow(teamId);
    this.bus.toast(r.ok ? "Formation off" : r.error, r.ok ? "info" : "error");
  }

  private async cancel(orderId: string): Promise<void> {
    const r = await api.cancelOrder(orderId);
    this.bus.toast(r.ok ? "Run cancelled" : r.error, r.ok ? "info" : "error");
  }
}

const STATUS: Record<string, string> = { running: "Running", done: "Done", needs_human: "Needs you", failed: "Failed", cancelled: "Cancelled" };
const MARK: Record<string, string> = { active: "●", done: "✓", approved: "✓", changes: "↺", failed: "✕" };

// Portrait: class icon in a team-colour frame. Draggable onto a role slot (from a slot, the two swap).
function face(u: Unit | undefined, color: string, fromNode?: string): HTMLElement {
  const f = h("span", { class: "hud-wf-face", style: `--team:${color}`, title: u ? `${u.name} (${u.class})` : "Missing unit", draggable: u ? "true" : null },
    u ? icon(classIcon(u.class), 18) : icon("dot", 18));
  if (u) f.addEventListener("dragstart", (ev) => { ev.stopPropagation(); ev.dataTransfer?.setData(DND, `${u.id}|${fromNode ?? ""}`); });
  return f;
}

function stepRow(s: State, wf: Workflow | null, st: WorkflowStep): HTMLElement {
  const role = wf?.nodes.find((nd) => nd.id === st.nodeId)?.role ?? st.nodeId;
  const who = s.units.find((u) => u.id === st.unitId)?.name ?? st.unitId;
  const text = trimName(st.summary, who);
  return h("li", { class: "hud-wf-step", "data-state": st.status },
    h("span", { class: "hud-wf-step-mark" }, MARK[st.status] ?? "•"),
    h("span", { class: "hud-wf-step-text" }, h("b", null, who), h("span", { class: "hud-wf-step-role" }, role), text || (st.status === "active" ? "working" : "")),
    h("span", { class: "hud-feed-time", "data-ts": st.ts }, ago(st.ts)),
  );
}

/** Drop a leading "<Name>:" the agent put in front of its own reply ("Ada: Ada: plan"). */
export function trimName(text: string, name: string): string {
  let t = (text ?? "").trim();
  const p = `${name.toLowerCase()}:`;
  while (name && t.toLowerCase().startsWith(p)) t = t.slice(p.length).trim();
  return t;
}

interface GraphOpts {
  r: number; rowH: number; width: number; color: string; labels?: boolean; thumb?: boolean; aria?: string;
  face: (nd: WorkflowNode) => string;
  state?: (nd: WorkflowNode) => NodeState;
  title?: (nd: WorkflowNode) => string;
  onNode?: (nd: WorkflowNode) => void;
  hover?: (nd: WorkflowNode | null) => void;
}

// Node-link diagram: columns by depth, forward edges as arrows, changes edges as dashed loops underneath.
function graph(wf: Workflow, o: GraphOpts): SVGElement {
  const { r, rowH, width } = o;
  const cols = columns(wf);
  const rows = Math.max(1, ...cols.map((c) => c.length));
  const hasBack = wf.edges.some((ed) => ed.on === "changes");
  const top = 4 + r;
  const H = top + (rows - 1) * rowH + r + (o.labels ? 14 : 4) + (hasBack ? r + (o.labels ? 14 : 6) : 0);
  const gap = r + 6;
  const colW = (width - 2 * gap) / Math.max(1, cols.length);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((col, ci) => col.forEach((id, ri) => pos.set(id, { x: gap + colW * (ci + 0.5), y: top + ((rows - col.length) * rowH) / 2 + ri * rowH })));

  const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, class: `hud-wf-svg${o.thumb ? " hud-wf-thumb" : ""}`, role: "img", "aria-label": o.aria ?? `${wf.preset} formation` });
  for (const ed of wf.edges) {
    const a = pos.get(ed.from);
    const b = pos.get(ed.to);
    if (!a || !b) continue;
    const back = ed.on === "changes" || b.x < a.x || (b.x === a.x && b.y <= a.y);
    const cls = `hud-wf-edge hud-wf-edge-${ed.on}`;
    if (back) {
      const dip = Math.max(a.y, b.y) + r + (o.labels ? 18 : 8);
      svg.append(el("path", { d: `M ${a.x} ${a.y + r} C ${a.x} ${dip}, ${b.x} ${dip}, ${b.x} ${b.y + r + 2}`, class: cls }), arrow(b.x, b.y + r + 1, -Math.PI / 2, cls, o.thumb ? 3 : 5));
      if (o.labels && ed.on === "changes") svg.append(label((a.x + b.x) / 2, dip + 7, "changes", "hud-wf-edge-label"));
    } else {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const [x2, y2] = [b.x - Math.cos(ang) * (r + 1), b.y - Math.sin(ang) * (r + 1)];
      svg.append(el("line", { x1: a.x + Math.cos(ang) * r, y1: a.y + Math.sin(ang) * r, x2, y2, class: cls }), arrow(x2, y2, ang, cls, o.thumb ? 3 : 5));
    }
  }
  for (const nd of wf.nodes) {
    const p = pos.get(nd.id);
    if (!p) continue;
    const state = o.state?.(nd) ?? "idle";
    const g = el("g", { class: "hud-wf-node", "data-state": state, "data-node": nd.id, transform: `translate(${p.x} ${p.y})`, style: `--team:${safeColor(o.color)}` });
    if (o.title) { const t = el("title"); t.textContent = o.title(nd); g.append(t); }
    g.append(el("circle", { r: r + 4, class: "hud-wf-halo" }), el("circle", { r, class: "hud-wf-disc" }), label(0, r * 0.34, o.face(nd), "hud-wf-glyph"));
    if (o.labels) g.append(label(0, r + 11, cap(nd.role), "hud-wf-role-label"), badge(state, r));
    if (o.onNode) g.addEventListener("click", () => o.onNode!(nd));
    if (o.hover) { g.addEventListener("mouseenter", () => o.hover!(nd)); g.addEventListener("mouseleave", () => o.hover!(null)); }
    svg.append(g);
  }
  return svg;
}

function badge(state: NodeState, r: number): SVGElement {
  const g = el("g", { class: "hud-wf-badge", transform: `translate(${r - 2} ${-r + 2})` });
  if (state === "idle") return g;
  g.append(el("circle", { r: 6 }), label(0, 3.5, MARK[state] ?? "", ""));
  return g;
}

function arrow(x: number, y: number, ang: number, cls: string, size: number): SVGElement {
  const p = (a: number) => `${x - Math.cos(ang + a) * size},${y - Math.sin(ang + a) * size}`;
  return el("polygon", { points: `${x},${y} ${p(0.5)} ${p(-0.5)}`, class: `${cls} hud-wf-arrow` });
}

function label(x: number, y: number, text: string, cls: string): SVGElement {
  const t = el("text", { x, y, class: cls, "text-anchor": "middle" });
  t.textContent = text;
  return t;
}

function el(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const x = document.createElementNS(SVG, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, String(v));
  return x;
}

// Mouse with the right button lit, for the start cue.
function mouseIcon(): SVGElement {
  const svg = el("svg", { viewBox: "0 0 24 24", class: "lk-icon hud-wf-mouse", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "aria-hidden": "true" });
  svg.append(el("rect", { x: 6, y: 3, width: 12, height: 18, rx: 6 }), el("path", { d: "M12 3v7M6 10h12" }),
    el("path", { d: "M12 3.2a5.8 5.8 0 0 1 5.8 5.8v1H12z", fill: "currentColor", stroke: "none", class: "hud-wf-mouse-btn" }));
  return svg;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
