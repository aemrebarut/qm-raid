// Team workflows: runs a team's agent graph (planner -> implementer -> reviewer, loops, fan-out) as a chain of normal orders.
// game.ts owns orders, walking and prompts (FlowHooks); this file owns store.state.workflowRuns and the workflow.* events.
// Interface fixed in docs/lanes/eng-plan.md "Team workflows"; rules in docs/CONTRACT.md "Team workflows".
import type { Order, Workflow, WorkflowEdge, WorkflowNode, WorkflowRun, WorkflowStep } from "../../../contract/types.ts";
import { ROLE_INSTRUCTIONS } from "./config.ts";
import { emit, store } from "./store.ts";

export interface NodeBrief {
  runId: string; nodeId: string; role: string; instructions: string;
  previous: { nodeId: string; role: string; unitId: string; reply: string }[]; // latest last
}
export interface FlowHooks {
  startOrder(unitId: string, targetId: string, brief: NodeBrief): string | null; // creates the workflow order, returns its id
  cancelOrder(orderId: string): void; // re-enters onOrderEnded with the cancelled order
  setTargetStatus(targetId: string, status: "open" | "engaged" | "resolved"): void;
}

const RUNS_KEPT = 20;
const DEFAULT_MAX_LOOPS = 2;
const MAX_NODES = 12;
const PREVIOUS_MAX = 8; // replies handed to the next node
const REPLY_MAX = 2000; // chars kept per reply
const SUMMARY_MAX = 160;
const PRESETS: Workflow["preset"][] = ["solo", "pair", "trio", "fanout", "custom"];
const EDGE_ON: WorkflowEdge["on"][] = ["done", "approved", "changes"];
const VERDICT = /VERDICT:\s*(APPROVED|CHANGES)(?::\s*(.*))?/i;

type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string };
type Ending = Exclude<WorkflowRun["status"], "running">;
// Per-run data that is not part of the contract: the graph as it was at start, nodes waiting to start, finished replies.
interface Ctx { run: WorkflowRun; wf: Workflow; pending: string[]; done: NodeBrief["previous"] }

let hooks: FlowHooks | null = null;
// Never reset, so an order from before /api/reset can never match a new run.
let nextRun = 1;
const ctxs = new Map<string, Ctx>();

const S = () => store.state;
const runs = () => S().workflowRuns;
// After /api/reset store.state is replaced: runs from before it are dead and ignore late events.
const live = (c: Ctx) => runs().includes(c.run);
const head = (text: string, n = SUMMARY_MAX) => {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 3)}...` : s;
};

export function initWorkflows(h: FlowHooks): void {
  hooks = h;
}

// ---------- graphs ----------

const node = (id: string, role: string, unitId: string): WorkflowNode => ({ id, role, unitId });
const edge = (from: string, to: string, on: WorkflowEdge["on"]): WorkflowEdge => ({ from, to, on });
const NEEDS: Record<string, number> = { solo: 1, pair: 2, trio: 3, fanout: 3 };

// Members bind to roles in member order.
export function presetWorkflow(preset: Workflow["preset"], members: string[]): Workflow | { error: string } {
  const m = [...new Set((Array.isArray(members) ? members : []).filter((x) => typeof x === "string" && x))];
  const need = NEEDS[preset];
  if (!need) return { error: preset === "custom" ? "custom needs a full workflow graph" : "preset must be solo, pair, trio or fanout" };
  if (m.length < need) return { error: `${preset} needs ${need} member${need > 1 ? "s" : ""}` };
  let nodes: WorkflowNode[];
  let edges: WorkflowEdge[];
  if (preset === "solo") {
    nodes = [node("implementer", "implementer", m[0]!)];
    edges = [];
  } else if (preset === "pair") {
    nodes = [node("implementer", "implementer", m[0]!), node("reviewer", "reviewer", m[1]!)];
    edges = [edge("implementer", "reviewer", "done"), edge("reviewer", "implementer", "changes")];
  } else if (preset === "trio") {
    nodes = [node("planner", "planner", m[0]!), node("implementer", "implementer", m[1]!), node("reviewer", "reviewer", m[2]!)];
    edges = [edge("planner", "implementer", "done"), edge("implementer", "reviewer", "done"), edge("reviewer", "implementer", "changes")];
  } else {
    const impls = m.slice(1, -1).map((u, i) => node(`implementer${i + 1}`, "implementer", u));
    nodes = [node("planner", "planner", m[0]!), ...impls, node("reviewer", "reviewer", m[m.length - 1]!)];
    edges = [
      ...impls.map((n) => edge("planner", n.id, "done")),
      ...impls.map((n) => edge(n.id, "reviewer", "done")),
      ...impls.map((n) => edge("reviewer", n.id, "changes")),
    ];
  }
  return { preset, entry: nodes[0]!.id, nodes, edges, maxLoops: DEFAULT_MAX_LOOPS };
}

// Error text or null. Fills missing optional fields in place (preset "custom", maxLoops 2, edges []), since the
// engine stores a user-drawn graph as given.
export function validateWorkflow(w: Workflow, members: string[]): string | null {
  if (!w || typeof w !== "object" || Array.isArray(w)) return "workflow must be an object";
  const x = w as any;
  x.preset ??= "custom";
  x.maxLoops ??= DEFAULT_MAX_LOOPS;
  x.edges ??= [];
  if (!PRESETS.includes(x.preset)) return "preset must be solo, pair, trio, fanout or custom";
  if (!Array.isArray(x.nodes) || !x.nodes.length) return "workflow needs at least one node";
  if (x.nodes.length > MAX_NODES) return `a workflow has at most ${MAX_NODES} nodes`;
  const ids = new Set<string>();
  for (const n of x.nodes) {
    if (!n || typeof n !== "object") return "each node must be an object";
    if (typeof n.id !== "string" || !n.id.trim() || n.id.length > 40) return "node id must be a non-empty string of at most 40 characters";
    if (ids.has(n.id)) return `duplicate node id ${n.id}`;
    ids.add(n.id);
    if (typeof n.role !== "string" || !n.role.trim() || n.role.length > 40) return `node ${n.id} needs a role (at most 40 characters)`;
    if (typeof n.unitId !== "string" || !members.includes(n.unitId)) return `node ${n.id}: unit ${String(n.unitId)} is not a member of the team`;
    if (n.instructions !== undefined && (typeof n.instructions !== "string" || n.instructions.length > 2000)) return `node ${n.id}: instructions must be text of at most 2000 characters`;
  }
  if (typeof x.entry !== "string" || !ids.has(x.entry)) return "entry must be the id of a node";
  if (!Array.isArray(x.edges)) return "edges must be an array";
  for (const e of x.edges) {
    if (!e || typeof e !== "object" || !ids.has(e.from) || !ids.has(e.to)) return "every edge needs from and to node ids";
    if (!EDGE_ON.includes(e.on)) return "edge on must be done, approved or changes";
  }
  if (!Number.isInteger(x.maxLoops) || x.maxLoops < 0 || x.maxLoops > 10) return "maxLoops must be an integer from 0 to 10";
  return null;
}

// The last line with a VERDICT wins, so a reviewer quoting an older verdict still ends with its own.
export function parseVerdict(text: string): { verdict: "approved" | "changes"; detail: string } | null {
  let found: { verdict: "approved" | "changes"; detail: string } | null = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(VERDICT);
    if (m) found = { verdict: m[1]!.toLowerCase() as "approved" | "changes", detail: (m[2] ?? "").replace(/[*_`\s]+$/, "").trim() };
  }
  return found;
}

// Only a node with approved / changes edges judges (its reply's VERDICT picks the edges); others just finish (done).
function isJudge(wf: Workflow, n: WorkflowNode): boolean {
  return wf.edges.some((e) => e.from === n.id && e.on !== "done");
}

function outcome(wf: Workflow, n: WorkflowNode, reply: string): { status: "done" | "approved" | "changes"; summary: string } {
  if (!isJudge(wf, n)) return { status: "done", summary: head(reply) };
  const v = parseVerdict(reply);
  if (!v) return { status: "approved", summary: head(`APPROVED (no VERDICT line): ${reply}`) };
  if (v.verdict === "changes") return { status: "changes", summary: head(`CHANGES: ${v.detail || reply}`) };
  return { status: "approved", summary: head(v.detail ? `APPROVED: ${v.detail}` : "APPROVED") };
}

// Does `from` lead to `to` along forward edges? `changes` edges are loops back and never make a node wait.
function reaches(wf: Workflow, from: string, to: string): boolean {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of wf.edges) {
      if (e.from !== n || e.on === "changes") continue;
      if (e.to === to) return true;
      if (!seen.has(e.to)) { seen.add(e.to); queue.push(e.to); }
    }
  }
  return false;
}

// Join: a pending node waits while it is still running or while any running or pending branch of this run leads to it.
function blocked(c: Ctx, id: string): boolean {
  if (c.run.active.includes(id)) return true;
  return [...c.run.active, ...c.pending].some((other) => other !== id && reaches(c.wf, other, id));
}

// ---------- runs ----------

function nodeById(c: Ctx, id: string): WorkflowNode {
  return c.wf.nodes.find((n) => n.id === id)!;
}

function startNode(c: Ctx, id: string): boolean {
  const n = nodeById(c, id);
  const brief: NodeBrief = {
    runId: c.run.id, nodeId: n.id, role: n.role,
    instructions: n.instructions?.trim() || ROLE_INSTRUCTIONS[n.role.toLowerCase()] || "",
    previous: c.done.slice(-PREVIOUS_MAX).map((p) => ({ ...p })),
  };
  const step: WorkflowStep = { nodeId: n.id, unitId: n.unitId, orderId: "", status: "active", summary: "", ts: Date.now() };
  c.run.steps.push(step);
  c.run.active.push(n.id);
  const orderId = hooks ? hooks.startOrder(n.unitId, c.run.targetId, brief) : null;
  if (orderId) step.orderId = orderId;
  // startOrder cancels the unit's previous order; if that was a step of this run, the run is already over.
  if (c.run.status !== "running") {
    if (orderId) hooks!.cancelOrder(orderId);
    if (step.status === "active") { step.status = "failed"; step.summary = `cancelled: run ${c.run.status}`; }
    c.run.active = c.run.active.filter((a) => a !== n.id);
    return false;
  }
  if (!orderId) {
    step.status = "failed";
    step.summary = `could not start: unit ${n.unitId} or target ${c.run.targetId} is gone`;
    c.run.active = c.run.active.filter((a) => a !== n.id);
    endRun(c, "failed");
    return false;
  }
  return true;
}

// Starts every pending node whose join is complete.
function pump(c: Ctx): void {
  while (c.run.status === "running" && c.pending.length) {
    let ready = c.pending.filter((id) => !blocked(c, id));
    if (!ready.length) {
      if (c.run.active.length) return;
      ready = [c.pending[0]!]; // pending nodes that only wait on each other (a forward cycle): first arrival goes
    }
    for (const id of ready) {
      c.pending = c.pending.filter((p) => p !== id);
      if (!startNode(c, id)) return;
    }
  }
}

function endRun(c: Ctx, status: Ending): void {
  if (c.run.status !== "running") return;
  c.run.status = status;
  c.pending = [];
  // Each cancel re-enters onOrderEnded, which marks that step failed now that the run is over.
  for (const s of [...c.run.steps]) if (s.status === "active" && s.orderId) hooks?.cancelOrder(s.orderId);
  for (const s of c.run.steps) if (s.status === "active") { s.status = "failed"; s.summary ||= `cancelled: run ${status}`; }
  c.run.active = [];
  if (!live(c)) return;
  const busy = S().orders.some((o) => o.targetId === c.run.targetId && o.status === "active");
  hooks?.setTargetStatus(c.run.targetId, status === "done" ? "resolved" : busy ? "engaged" : "open");
  emit("workflow.updated", { run: c.run });
}

// Keeps the last RUNS_KEPT runs in the state (running runs always stay) and forgets dead ones.
function trimRuns(): void {
  const list = runs();
  while (list.length > RUNS_KEPT) {
    const i = list.findIndex((r) => r.status !== "running");
    if (i < 0) break;
    list.splice(i, 1);
  }
  for (const [id, c] of ctxs) if (!live(c)) ctxs.delete(id);
}

export function startRun(teamId: number, targetId: string): Result<{ run: WorkflowRun }> {
  if (!hooks) return { ok: false, error: "workflows are not initialised" };
  const team = S().teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: "unknown team" };
  if (!team.workflow) return { ok: false, error: `team ${team.name} has no workflow` };
  const target = S().targets.find((t) => t.id === targetId);
  if (!target) return { ok: false, error: "unknown targetId" };
  if (target.status === "resolved") return { ok: false, error: "target already resolved" };
  // The run keeps the graph as it was at start; later edits apply to the next run.
  const wf = structuredClone(team.workflow);
  const err = validateWorkflow(wf, team.members);
  if (err) return { ok: false, error: err };
  const gone = wf.nodes.find((n) => !S().units.some((u) => u.id === n.unitId));
  if (gone) return { ok: false, error: `unit ${gone.unitId} of node ${gone.id} is gone` };
  // One run per team: a new team order replaces the running one.
  for (const c of [...ctxs.values()]) if (c.run.teamId === teamId && c.run.status === "running" && live(c)) endRun(c, "cancelled");
  const run: WorkflowRun = { id: `w${nextRun++}`, teamId, targetId, status: "running", loops: 0, active: [], steps: [] };
  const c: Ctx = { run, wf, pending: [], done: [] };
  ctxs.set(run.id, c);
  runs().push(run);
  trimRuns();
  if (!startNode(c, wf.entry)) {
    const why = run.steps[run.steps.length - 1]?.summary || "entry node did not start";
    return { ok: false, error: why };
  }
  hooks.setTargetStatus(targetId, "engaged");
  emit("workflow.updated", { run });
  return { ok: true, run };
}

function ctxForOrder(order: Order): Ctx | undefined {
  const byRun = order.runId ? ctxs.get(order.runId) : undefined;
  if (byRun && byRun.run.steps.some((s) => s.orderId === order.id)) return byRun;
  for (const c of ctxs.values()) if (c.run.steps.some((s) => s.orderId === order.id)) return c;
  return undefined;
}

// Called by game.ts when a workflow order becomes done / failed / cancelled (reply set, unit already released).
export function onOrderEnded(order: Order): void {
  if (!order || (order.status !== "done" && order.status !== "failed" && order.status !== "cancelled")) return;
  const c = ctxForOrder(order);
  if (!c || !live(c)) return;
  const step = c.run.steps.find((s) => s.orderId === order.id);
  if (!step || step.status !== "active") return;
  const n = nodeById(c, step.nodeId);
  const reply = String(order.reply ?? "");
  c.run.active = c.run.active.filter((a) => a !== n.id);
  if (c.run.status !== "running") {
    // A step cancelled because its run ended (endRun), or a late end after the run finished.
    step.status = "failed";
    step.summary = order.status === "done" ? head(reply) : `cancelled: run ${c.run.status}`;
    emit("workflow.updated", { run: c.run });
    return;
  }
  if (order.status !== "done") {
    step.status = "failed";
    step.summary = order.status === "cancelled" ? "cancelled" : head(reply || "failed");
    endRun(c, order.status === "cancelled" ? "cancelled" : "failed");
    return;
  }
  const out = outcome(c.wf, n, reply);
  step.status = out.status;
  step.summary = out.summary;
  c.done.push({ nodeId: n.id, role: n.role, unitId: n.unitId, reply: reply.trim().slice(0, REPLY_MAX) });
  const next = c.wf.edges.filter((e) => e.from === n.id && (e.on === "done" || e.on === out.status));
  if (out.status === "changes" && next.some((e) => e.on === "changes")) {
    c.run.loops++;
    if (c.run.loops > c.wf.maxLoops) return endRun(c, "needs_human");
  }
  for (const e of next) {
    const to = nodeById(c, e.to);
    if (to.unitId !== n.unitId) emit("workflow.handoff", { runId: c.run.id, fromUnitId: n.unitId, toUnitId: to.unitId, nodeId: to.id, summary: head(reply) });
    if (!c.pending.includes(to.id)) c.pending.push(to.id);
  }
  pump(c);
  if (c.run.status !== "running") return;
  // Done when nothing runs and nothing waits: the last finished node had no matching outgoing edge.
  if (!c.run.active.length && !c.pending.length) return endRun(c, "done");
  emit("workflow.updated", { run: c.run });
}

export function cancelRun(runId: string): Result {
  const c = ctxs.get(runId);
  if (!c || !live(c)) return { ok: false, error: "unknown run" };
  if (c.run.status !== "running") return { ok: false, error: `run is ${c.run.status}` };
  endRun(c, "cancelled");
  return { ok: true };
}

export function runForOrder(orderId: string): WorkflowRun | undefined {
  return runs().find((r) => r.steps.some((s) => s.orderId === orderId));
}
