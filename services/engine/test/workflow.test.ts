// Unit tests for src/workflow.ts with fake hooks, no services: cd services/engine && bun test test/workflow.test.ts
import { beforeEach, expect, test } from "bun:test";
import type { EngineEvent, Order, Workflow } from "../../../contract/types.ts";
import { store, subscribe } from "../src/store.ts";
import { fixtureState } from "../src/fixture.ts";
import { cancelRun, initWorkflows, onOrderEnded, parseVerdict, presetWorkflow, runForOrder, startRun, validateWorkflow, type NodeBrief } from "../src/workflow.ts";

// Fake game.ts: startOrder cancels the unit's previous open order (re-entering onOrderEnded), cancelOrder re-enters too.
let nextOrder = 1;
const briefs = new Map<string, NodeBrief>();
function endOrder(o: Order, status: "done" | "failed" | "cancelled", reply: string | null = null): void {
  o.status = status;
  o.reply = reply;
  const u = store.state.units.find((x) => x.id === o.unitId);
  if (u && u.orderId === o.id) u.orderId = null;
  onOrderEnded(o);
}
initWorkflows({
  startOrder(unitId, targetId, brief) {
    const u = store.state.units.find((x) => x.id === unitId);
    if (!u || !store.state.targets.some((t) => t.id === targetId)) return null;
    const prev = store.state.orders.find((o) => o.id === u.orderId && o.status === "active");
    if (prev) endOrder(prev, "cancelled");
    const o: Order = { id: `o${nextOrder++}`, unitId, targetId, status: "active", source: "workflow", runId: brief.runId, nodeId: brief.nodeId, vetoDeadline: null, reply: null };
    store.state.orders.push(o);
    u.orderId = o.id;
    briefs.set(o.id, brief);
    return o.id;
  },
  cancelOrder(orderId) {
    const o = store.state.orders.find((x) => x.id === orderId);
    if (o && o.status === "active") endOrder(o, "cancelled");
  },
  setTargetStatus(targetId, status) {
    const t = store.state.targets.find((x) => x.id === targetId);
    if (t) t.status = status;
  },
});

let events: EngineEvent[] = [];
subscribe((chunk) => events.push(JSON.parse(chunk.slice(6))));
const target = (id: string) => store.state.targets.find((t) => t.id === id)!;
const team = (id: number) => store.state.teams.find((t) => t.id === id)!;
const active = () => store.state.orders.filter((o) => o.status === "active");
const activeOf = (unitId: string) => active().find((o) => o.unitId === unitId)!;
const finish = (unitId: string, reply: string) => endOrder(activeOf(unitId), "done", reply);
const handoffs = () => events.filter((e) => e.type === "workflow.handoff").map((e: any) => `${e.fromUnitId}>${e.toUnitId}:${e.nodeId}`);

function setPreset(teamId: number, preset: Workflow["preset"], members?: string[]): Workflow {
  const t = team(teamId);
  if (members) t.members = members;
  const w = presetWorkflow(preset, t.members);
  if ("error" in w) throw new Error(w.error);
  t.workflow = w;
  return w;
}
function run(teamId: number, targetId: string) {
  const r = startRun(teamId, targetId);
  if (!r.ok) throw new Error(r.error);
  return r.run;
}

beforeEach(() => {
  store.state = fixtureState();
  events = [];
  briefs.clear();
});

test("presets bind members in member order", () => {
  expect(presetWorkflow("solo", ["u1"])).toMatchObject({ preset: "solo", entry: "implementer", nodes: [{ id: "implementer", role: "implementer", unitId: "u1" }], edges: [], maxLoops: 2 });
  const pair = presetWorkflow("pair", ["u1", "u2"]) as Workflow;
  expect(pair.edges).toEqual([{ from: "implementer", to: "reviewer", on: "done" }, { from: "reviewer", to: "implementer", on: "changes" }]);
  const trio = presetWorkflow("trio", ["u1", "u2", "u3", "u4"]) as Workflow;
  expect(trio.nodes.map((n) => `${n.id}=${n.unitId}`)).toEqual(["planner=u1", "implementer=u2", "reviewer=u3"]);
  expect(trio.entry).toBe("planner");
  expect(trio.edges).toEqual([
    { from: "planner", to: "implementer", on: "done" }, { from: "implementer", to: "reviewer", on: "done" }, { from: "reviewer", to: "implementer", on: "changes" },
  ]);
  const fan = presetWorkflow("fanout", ["u1", "u2", "u3", "u4"]) as Workflow;
  expect(fan.nodes.map((n) => `${n.id}=${n.unitId}`)).toEqual(["planner=u1", "implementer1=u2", "implementer2=u3", "reviewer=u4"]);
  expect(fan.edges.filter((e) => e.on === "changes").map((e) => e.to)).toEqual(["implementer1", "implementer2"]);
  expect(presetWorkflow("trio", ["u1", "u2"])).toEqual({ error: "trio needs 3 members" });
  expect(presetWorkflow("pair", ["u1"])).toEqual({ error: "pair needs 2 members" });
  expect("error" in presetWorkflow("custom", ["u1"])).toBe(true);
  for (const p of ["solo", "pair", "trio", "fanout"] as const) expect(validateWorkflow(presetWorkflow(p, ["u1", "u2", "u3"]) as Workflow, ["u1", "u2", "u3"])).toBeNull();
});

test("validateWorkflow fills defaults in place and rejects broken graphs", () => {
  const w: any = { entry: "a", nodes: [{ id: "a", role: "implementer", unitId: "u1" }] };
  expect(validateWorkflow(w, ["u1"])).toBeNull();
  expect(w).toMatchObject({ preset: "custom", maxLoops: 2, edges: [] });
  const ok = () => ({ preset: "custom", entry: "a", maxLoops: 2, nodes: [{ id: "a", role: "planner", unitId: "u1" }, { id: "b", role: "reviewer", unitId: "u2" }], edges: [{ from: "a", to: "b", on: "done" }] }) as any;
  expect(validateWorkflow(ok(), ["u1", "u2"])).toBeNull();
  expect(validateWorkflow(ok(), ["u1"])).toContain("not a member");
  expect(validateWorkflow({ ...ok(), entry: "z" }, ["u1", "u2"])).toContain("entry");
  expect(validateWorkflow({ ...ok(), edges: [{ from: "a", to: "z", on: "done" }] }, ["u1", "u2"])).toContain("edge");
  expect(validateWorkflow({ ...ok(), edges: [{ from: "a", to: "b", on: "maybe" }] }, ["u1", "u2"])).toContain("edge on");
  expect(validateWorkflow({ ...ok(), maxLoops: 99 }, ["u1", "u2"])).toContain("maxLoops");
  expect(validateWorkflow({ ...ok(), nodes: [{ id: "a", role: "x", unitId: "u1" }, { id: "a", role: "y", unitId: "u2" }] }, ["u1", "u2"])).toContain("duplicate");
  expect(validateWorkflow({ ...ok(), preset: "mesh" }, ["u1", "u2"])).toContain("preset");
  expect(validateWorkflow(null as any, [])).toContain("object");
});

test("parseVerdict takes the last VERDICT line", () => {
  expect(parseVerdict("looks good\nVERDICT: APPROVED")).toEqual({ verdict: "approved", detail: "" });
  expect(parseVerdict("VERDICT: APPROVED\nold\n**VERDICT: changes: add an idempotency key**")).toEqual({ verdict: "changes", detail: "add an idempotency key" });
  expect(parseVerdict("no verdict here")).toBeNull();
});

test("trio: planner -> implementer -> reviewer (changes) -> implementer -> reviewer (approved) -> done", () => {
  setPreset(1, "trio"); // u1 planner, u2 implementer, u3 reviewer
  const r = run(1, "t101");
  expect(r).toMatchObject({ id: expect.stringMatching(/^w\d+$/), teamId: 1, targetId: "t101", status: "running", loops: 0, active: ["planner"] });
  expect(store.state.workflowRuns).toContain(r);
  expect(target("t101").status).toBe("engaged");
  const o1 = activeOf("u1");
  expect(o1).toMatchObject({ source: "workflow", runId: r.id, nodeId: "planner" });
  expect(briefs.get(o1.id)).toMatchObject({ role: "planner", instructions: expect.stringContaining("numbered plan"), previous: [] });
  expect(runForOrder(o1.id)).toBe(r);

  finish("u1", "1. add a key\n2. dedupe retries");
  expect(target("t101").status).toBe("engaged"); // a step never resolves the target
  expect(r.active).toEqual(["implementer"]);
  expect(briefs.get(activeOf("u2").id)!.previous).toEqual([{ nodeId: "planner", role: "planner", unitId: "u1", reply: "1. add a key\n2. dedupe retries" }]);

  finish("u2", "Implemented the key.");
  expect(r.active).toEqual(["reviewer"]);
  expect(briefs.get(activeOf("u3").id)!.instructions).toContain("VERDICT");

  finish("u3", "Missing a test.\nVERDICT: CHANGES: add a retry test");
  expect(r.loops).toBe(1);
  expect(r.steps[2]).toMatchObject({ nodeId: "reviewer", status: "changes", summary: "CHANGES: add a retry test" });
  const again = briefs.get(activeOf("u2").id)!;
  expect(again.previous.map((p) => p.nodeId)).toEqual(["planner", "implementer", "reviewer"]); // latest last

  finish("u2", "Added the retry test.");
  finish("u3", "All good.\nVERDICT: APPROVED");
  expect(r.status).toBe("done");
  expect(r.active).toEqual([]);
  expect(r.steps.map((s) => `${s.nodeId}:${s.status}`)).toEqual(["planner:done", "implementer:done", "reviewer:changes", "implementer:done", "reviewer:approved"]);
  expect(target("t101").status).toBe("resolved");
  expect(store.state.orders.filter((o) => o.source === "workflow")).toHaveLength(5);
  expect(handoffs()).toEqual(["u1>u2:implementer", "u2>u3:reviewer", "u3>u2:implementer", "u2>u3:reviewer"]);
  const last = events.filter((e) => e.type === "workflow.updated").pop() as any;
  expect(last.run.status).toBe("done");
});

test("a reviewer reply without a VERDICT line counts as approved", () => {
  setPreset(1, "pair", ["u1", "u2"]);
  const r = run(1, "t102");
  finish("u1", "done");
  finish("u2", "Fine by me.");
  expect(r.status).toBe("done");
  expect(r.steps[1]).toMatchObject({ status: "approved", summary: expect.stringContaining("no VERDICT line") });
});

test("changes past maxLoops ends the run needs_human and reopens the target", () => {
  const w = setPreset(1, "trio");
  w.maxLoops = 1;
  const r = run(1, "t101");
  finish("u1", "plan");
  finish("u2", "impl");
  finish("u3", "VERDICT: CHANGES: one");
  expect(r.status).toBe("running");
  finish("u2", "impl 2");
  finish("u3", "VERDICT: CHANGES: two");
  expect(r.status).toBe("needs_human");
  expect(r.loops).toBe(2);
  expect(active()).toHaveLength(0);
  expect(target("t101").status).toBe("open");
});

test("fanout: implementers run in parallel, the reviewer joins them, changes fans out again", () => {
  setPreset(1, "fanout", ["u1", "u2", "u3", "u4"]); // planner u1, implementers u2 u3, reviewer u4
  const r = run(1, "t104");
  finish("u1", "plan");
  expect([...r.active].sort()).toEqual(["implementer1", "implementer2"]);
  finish("u2", "part one");
  expect(r.active).toEqual(["implementer2"]); // reviewer waits for the other branch
  expect(activeOf("u4")).toBeUndefined();
  finish("u3", "part two");
  expect(r.active).toEqual(["reviewer"]);
  expect(briefs.get(activeOf("u4").id)!.previous.map((p) => p.unitId)).toEqual(["u1", "u2", "u3"]);
  finish("u4", "VERDICT: CHANGES: both parts need logs");
  expect([...r.active].sort()).toEqual(["implementer1", "implementer2"]);
  finish("u3", "logs two");
  finish("u2", "logs one");
  finish("u4", "VERDICT: APPROVED");
  expect(r.status).toBe("done");
  expect(r.loops).toBe(1);
  expect(target("t104").status).toBe("resolved");
});

test("a custom graph with uneven branches waits for the longer branch", () => {
  const t = team(1);
  t.members = ["u1", "u2", "u3", "u4"];
  t.workflow = {
    preset: "custom", entry: "p", maxLoops: 2,
    nodes: [{ id: "p", role: "planner", unitId: "u1" }, { id: "a", role: "implementer", unitId: "u2" }, { id: "b", role: "implementer", unitId: "u3" }, { id: "c", role: "tester", unitId: "u1" }, { id: "r", role: "reviewer", unitId: "u4" }],
    edges: [{ from: "p", to: "a", on: "done" }, { from: "p", to: "b", on: "done" }, { from: "b", to: "c", on: "done" }, { from: "a", to: "r", on: "done" }, { from: "c", to: "r", on: "done" }],
  };
  const r = run(1, "t101");
  finish("u1", "plan");
  finish("u2", "a done");
  expect(r.active).toEqual(["b"]); // r waits: b -> c -> r is still running
  finish("u3", "b done");
  expect(r.active).toEqual(["c"]);
  finish("u1", "c done");
  expect(r.active).toEqual(["r"]);
  finish("u4", "ok"); // no approved/changes edges: the reviewer just finishes
  expect(r.steps.at(-1)!.status).toBe("done");
  expect(r.status).toBe("done");
});

test("cancelRun cancels active orders; cancelling a step order cancels the run; late replies are ignored", () => {
  setPreset(1, "trio");
  const r = run(1, "t101");
  finish("u1", "plan");
  const o2 = activeOf("u2");
  expect(cancelRun(r.id)).toEqual({ ok: true });
  expect(r.status).toBe("cancelled");
  expect(o2.status).toBe("cancelled");
  expect(r.steps[1]).toMatchObject({ status: "failed" });
  expect(target("t101").status).toBe("open");
  expect(cancelRun(r.id)).toEqual({ ok: false, error: "run is cancelled" });
  expect(cancelRun("w999")).toEqual({ ok: false, error: "unknown run" });
  onOrderEnded({ ...o2, status: "done", reply: "late" }); // stale: nothing changes
  expect(r.steps).toHaveLength(2);

  // Cancelling the order itself (DELETE unit, a user order on that unit, ...) ends the run too.
  const r2 = run(1, "t101");
  endOrder(activeOf("u1"), "cancelled");
  expect(r2.status).toBe("cancelled");
  expect(active()).toHaveLength(0);
});

test("a failed step fails the run and reopens the target", () => {
  setPreset(1, "trio");
  const r = run(1, "t101");
  finish("u1", "plan");
  endOrder(activeOf("u2"), "failed", "bridge error");
  expect(r.status).toBe("failed");
  expect(r.steps[1]).toMatchObject({ status: "failed", summary: "bridge error" });
  expect(target("t101").status).toBe("open");
});

test("a new team order replaces the team's running run", () => {
  setPreset(1, "trio");
  const r1 = run(1, "t101");
  const r2 = run(1, "t102");
  expect(r1.status).toBe("cancelled");
  expect(r2.status).toBe("running");
  expect(target("t101").status).toBe("open");
  expect(target("t102").status).toBe("engaged");
  expect(active().map((o) => o.runId)).toEqual([r2.id]);
});

test("startRun errors: no workflow, unknown or resolved target, gone unit", () => {
  expect(startRun(1, "t101")).toEqual({ ok: false, error: "team Red has no workflow" });
  setPreset(1, "trio");
  expect(startRun(1, "nope")).toEqual({ ok: false, error: "unknown targetId" });
  target("t101").status = "resolved";
  expect(startRun(1, "t101")).toEqual({ ok: false, error: "target already resolved" });
  expect(startRun(9, "t102")).toEqual({ ok: false, error: "unknown team" });
  store.state.units = store.state.units.filter((u) => u.id !== "u2");
  expect(startRun(1, "t102")).toMatchObject({ ok: false, error: expect.stringContaining("u2") });
});

test("after a reset old runs are dead and run ids keep counting", () => {
  setPreset(1, "trio");
  const r1 = run(1, "t101");
  const o1 = activeOf("u1");
  store.state = fixtureState();
  onOrderEnded({ ...o1, status: "done", reply: "late" });
  expect(runForOrder(o1.id)).toBeUndefined();
  expect(store.state.workflowRuns).toEqual([]);
  setPreset(1, "trio");
  const r2 = run(1, "t101");
  expect(Number(r2.id.slice(1))).toBeGreaterThan(Number(r1.id.slice(1)));
});

test("state keeps the last 20 runs", () => {
  setPreset(1, "solo");
  for (let i = 0; i < 25; i++) {
    run(1, "t101");
    finish("u1", `done ${i}`);
    target("t101").status = "open";
  }
  expect(store.state.workflowRuns).toHaveLength(20);
  expect(store.state.workflowRuns.every((r) => r.status === "done")).toBe(true);
});
