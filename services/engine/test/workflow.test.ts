// Unit tests for src/workflow.ts with fake hooks, no services: cd services/engine && bun test test/workflow.test.ts
import { beforeEach, expect, test } from "bun:test";
import type { EngineEvent, Order, Workflow } from "../../../contract/types.ts";
import { store, subscribe } from "../src/store.ts";
import { fixtureState } from "../src/fixture.ts";
import { cancelRun, initWorkflows, loadRuns, onOrderEnded, parseVerdict, presetWorkflow, runForOrder, saveRuns, startRun, validateWorkflow, type NodeBrief } from "../src/workflow.ts";

// Fake game.ts: startOrder cancels the unit's previous open order (re-entering onOrderEnded), cancelOrder re-enters too.
// W3: a unit's proposed team order (autopilot, teamId set) for the same target becomes the entry step instead.
let nextOrder = 1;
type TeamOrder = Order & { teamId?: number }; // W3: Order.teamId (contract pending)
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
    const proposal = store.state.orders.find((o) => o.id === u.orderId && o.status === "proposed" && (o as TeamOrder).teamId !== undefined && o.targetId === targetId);
    if (proposal) {
      Object.assign(proposal, { status: "active", source: "workflow", runId: brief.runId, nodeId: brief.nodeId, vetoDeadline: null });
      briefs.set(proposal.id, brief);
      return proposal.id;
    }
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

test("new presets: recon, testfirst, herald, duel graphs and role instructions", () => {
  const recon = presetWorkflow("recon", ["u1", "u2", "u3"]) as Workflow;
  expect(recon.nodes.map((n) => `${n.id}:${n.role}=${n.unitId}`)).toEqual(["scout:scout=u1", "implementer:implementer=u2", "reviewer:reviewer=u3"]);
  expect(recon.edges).toContainEqual({ from: "reviewer", to: "implementer", on: "changes" });
  const tf = presetWorkflow("testfirst", ["u1", "u2", "u3"]) as Workflow;
  expect(tf.entry).toBe("tester");
  const herald = presetWorkflow("herald", ["u1", "u2", "u3"]) as Workflow;
  expect(herald.edges).toEqual([{ from: "implementer", to: "reviewer", on: "done" }, { from: "reviewer", to: "herald", on: "approved" }, { from: "reviewer", to: "implementer", on: "changes" }]);
  const duel = presetWorkflow("duel", ["u1", "u2", "u3"]) as Workflow;
  expect(duel).toMatchObject({ entry: "implementer1", entries: ["implementer1", "implementer2"] });
  expect(duel.nodes.map((n) => `${n.id}:${n.role}=${n.unitId}`)).toEqual(["implementer1:implementer=u1", "implementer2:implementer=u2", "judge:judge=u3"]);
  expect(presetWorkflow("duel", ["u1", "u2"])).toEqual({ error: "duel needs 3 members" });
  for (const p of ["recon", "testfirst", "herald", "duel"] as const) expect(validateWorkflow(presetWorkflow(p, ["u1", "u2", "u3"]) as Workflow, ["u1", "u2", "u3"])).toBeNull();

  setPreset(1, "recon");
  run(1, "t101");
  expect(briefs.get(activeOf("u1").id)).toMatchObject({ role: "scout", instructions: expect.stringContaining("Investigate only") });
  store.state = fixtureState();
  setPreset(1, "testfirst");
  run(1, "t101");
  expect(briefs.get(activeOf("u1").id)!.instructions).toContain("failing regression test");
});

test("herald: the herald starts only after approval and the target resolves only after the customer update", () => {
  setPreset(1, "herald"); // implementer u1, reviewer u2, herald u3
  const r = run(1, "t101");
  finish("u1", "fix");
  finish("u2", "VERDICT: CHANGES: cover refunds");
  expect(r.active).toEqual(["implementer"]);
  expect(activeOf("u3")).toBeUndefined();
  finish("u1", "fix 2");
  finish("u2", "VERDICT: APPROVED");
  expect(r.active).toEqual(["herald"]);
  expect(briefs.get(activeOf("u3").id)!.instructions).toContain("customer update");
  expect(target("t101").status).toBe("engaged");
  finish("u3", "Dear Acme Robotics, ...");
  expect(r.status).toBe("done");
  expect(target("t101").status).toBe("resolved");
  expect(r.steps.map((s) => `${s.nodeId}:${s.status}`)).toEqual(["implementer:done", "reviewer:changes", "implementer:done", "reviewer:approved", "herald:done"]);
});

test("duel: both implementers start at once, the judge waits for both, changes restarts both, winner in the summary", () => {
  setPreset(1, "duel"); // implementers u1 u2, judge u3
  const r = run(1, "t104");
  expect([...r.active].sort()).toEqual(["implementer1", "implementer2"]);
  expect(active().map((o) => o.unitId).sort()).toEqual(["u1", "u2"]);
  expect(target("t104").status).toBe("engaged");
  finish("u2", "fix B");
  expect(r.active).toEqual(["implementer1"]);
  expect(handoffs()).toEqual([]); // the judge has not started, so no scroll yet
  finish("u1", "fix A");
  expect(r.active).toEqual(["judge"]);
  expect(handoffs()).toEqual(["u2>u3:judge", "u1>u3:judge"]);
  expect(briefs.get(activeOf("u3").id)).toMatchObject({ role: "judge", instructions: expect.stringContaining("winner") });
  finish("u3", "Neither checks the house rule.\nVERDICT: CHANGES: both must dedupe by idempotency key");
  expect([...r.active].sort()).toEqual(["implementer1", "implementer2"]);
  finish("u1", "fix A2");
  finish("u2", "fix B2");
  finish("u3", "A is cleaner.\nVERDICT: APPROVED (winner: Ada)");
  expect(r.status).toBe("done");
  expect(r.loops).toBe(1);
  expect(r.steps.at(-1)).toMatchObject({ nodeId: "judge", status: "approved", summary: "APPROVED (winner: Ada)" });
  expect(target("t104").status).toBe("resolved");
});

test("entries validation", () => {
  const base = () => ({ preset: "custom", maxLoops: 2, nodes: [{ id: "a", role: "implementer", unitId: "u1" }, { id: "b", role: "implementer", unitId: "u2" }], edges: [] }) as any;
  const w = { ...base(), entries: ["a", "b"] };
  expect(validateWorkflow(w, ["u1", "u2"])).toBeNull();
  expect(w.entry).toBe("a");
  expect(validateWorkflow({ ...base(), entry: "b", entries: ["a", "b"] }, ["u1", "u2"])).toContain("first of entries");
  expect(validateWorkflow({ ...base(), entry: "a", entries: ["a", "z"] }, ["u1", "u2"])).toContain("entries");
  expect(validateWorkflow({ ...base(), entry: "a", entries: ["a", "a"] }, ["u1", "u2"])).toContain("repeat");
});

test("rev P2: in a fanout the handoff to the reviewer fires only when the reviewer starts", () => {
  setPreset(1, "fanout", ["u1", "u2", "u3", "u4"]);
  const r = run(1, "t104");
  finish("u1", "plan");
  expect(handoffs()).toEqual(["u1>u2:implementer1", "u1>u3:implementer2"]);
  finish("u2", "part one");
  expect(r.active).toEqual(["implementer2"]);
  expect(handoffs().filter((h) => h.endsWith(":reviewer"))).toEqual([]);
  finish("u3", "part two");
  expect(handoffs().filter((h) => h.endsWith(":reviewer"))).toEqual(["u2>u4:reviewer", "u3>u4:reviewer"]);
  expect(r.active).toEqual(["reviewer"]);
});

test("rev P2: a large fanout hands the reviewer the planner and every branch", () => {
  const members = Array.from({ length: 11 }, (_, i) => `x${i + 1}`);
  for (const id of members) store.state.units.push({ ...store.state.units[0]!, id, name: id, orderId: null, team: 1 });
  setPreset(1, "fanout", members); // planner x1, implementers x2..x10, reviewer x11
  run(1, "t104");
  finish("x1", "the plan");
  for (let i = 2; i <= 10; i++) finish(`x${i}`, `branch ${i}`);
  const prev = briefs.get(activeOf("x11").id)!.previous;
  expect(prev.map((p) => p.unitId)).toEqual(members.slice(0, 10));
  expect(prev[0]!.reply).toBe("the plan");
});

test("previous keeps every node's latest reply first, then older rounds up to the cap, latest last", () => {
  setPreset(1, "trio");
  const r = run(1, "t101");
  finish("u1", "plan");
  finish("u2", "impl 1");
  finish("u3", "VERDICT: CHANGES: a");
  finish("u2", "impl 2");
  const prev = briefs.get(activeOf("u3").id)!.previous;
  expect(prev.map((p) => p.reply)).toEqual(["plan", "impl 1", "VERDICT: CHANGES: a", "impl 2"]);
  expect(r.status).toBe("running");
});

test("E18: a running fanout survives a restart (save, fresh state from JSON, load) and finishes", () => {
  setPreset(1, "fanout", ["u1", "u2", "u3", "u4"]);
  const r = run(1, "t104");
  finish("u1", "plan");
  finish("u2", "part one"); // reviewer is pending, implementer2 still running
  const saved = JSON.parse(JSON.stringify({ state: store.state, flow: saveRuns() }));
  store.state = saved.state; // what game.ts restoreGame does
  loadRuns(saved.flow);
  const r2 = store.state.workflowRuns.find((x) => x.id === r.id)!;
  expect(r2).not.toBe(r);
  expect(r2.active).toEqual(["implementer2"]);
  expect(runForOrder(activeOf("u3").id)).toBe(r2);
  finish("u3", "part two");
  expect(r2.active).toEqual(["reviewer"]);
  expect(handoffs().filter((h) => h.endsWith(":reviewer"))).toEqual(["u2>u4:reviewer", "u3>u4:reviewer"]);
  expect(briefs.get(activeOf("u4").id)!.previous.map((p) => p.reply)).toEqual(["plan", "part one", "part two"]);
  finish("u4", "VERDICT: APPROVED");
  expect(r2.status).toBe("done");
  expect(target("t104").status).toBe("resolved");
  const later = run(1, "t101");
  expect(Number(later.id.slice(1))).toBeGreaterThan(Number(r.id.slice(1)));
});

test("E18: without saved data a running run fails; a step the restore closed ends its run", () => {
  setPreset(1, "trio");
  const r = run(1, "t101");
  let saved = JSON.parse(JSON.stringify({ state: store.state, flow: saveRuns() }));
  store.state = saved.state;
  loadRuns(null);
  expect(store.state.workflowRuns[0]!.status).toBe("failed");
  expect(target("t101").status).toBe("open");

  store.state = fixtureState();
  setPreset(1, "trio");
  const r3 = run(1, "t101");
  saved = JSON.parse(JSON.stringify({ state: store.state, flow: saveRuns() }));
  store.state = saved.state;
  store.state.orders.find((o) => o.runId === r3.id)!.status = "cancelled"; // restoreGame closed it quietly
  loadRuns(saved.flow);
  expect(store.state.workflowRuns.find((x) => x.id === r3.id)!.status).toBe("cancelled");
  expect(r.status).toBe("running"); // the old object is dead and untouched
});

// W3: autopilot proposes a whole-team run; the proposal order (entry unit, teamId) becomes the entry step on go.
function propose(teamId: number, unitId: string, targetId: string): TeamOrder {
  const o: TeamOrder = { id: `o${nextOrder++}`, unitId, targetId, status: "proposed", source: "autopilot", teamId, vetoDeadline: Date.now() + 15000, reply: null };
  store.state.orders.push(o);
  store.state.units.find((u) => u.id === unitId)!.orderId = o.id;
  return o;
}
function go(o: TeamOrder) { // what game.ts does on go / expiry / adjust {targetId}
  const r = startRun(o.teamId!, o.targetId);
  if (!r.ok) { o.status = "failed"; o.reply = r.error; }
  return r;
}

test("W3: go turns the team proposal into the entry step, then the run goes on as usual", () => {
  setPreset(1, "trio");
  const p = propose(1, "u1", "t101");
  const res = go(p);
  expect(res.ok).toBe(true);
  const r = (res as { run: any }).run;
  expect(r.steps[0]).toMatchObject({ nodeId: "planner", unitId: "u1", orderId: p.id, status: "active" });
  expect(p).toMatchObject({ status: "active", source: "workflow", runId: r.id, nodeId: "planner", vetoDeadline: null });
  expect(runForOrder(p.id)).toBe(r);
  expect(store.state.orders).toHaveLength(1); // no second order, nothing cancelled
  expect(briefs.get(p.id)!.role).toBe("planner");
  finish("u1", "plan");
  finish("u2", "impl");
  finish("u3", "VERDICT: APPROVED");
  expect(r.status).toBe("done");
  expect(target("t101").status).toBe("resolved");
  expect(store.state.orders.map((o) => `${o.id}:${o.source}:${o.status}`)).toEqual([`${p.id}:workflow:done`, expect.stringMatching(/:workflow:done$/), expect.stringMatching(/:workflow:done$/)]);
});

test("W3: adjust {targetId} runs on the new target; duel reuses the proposal for the first entry only", () => {
  setPreset(1, "trio");
  const p = propose(1, "u1", "t101");
  p.targetId = "t102"; // adjust
  const r = go(p) as { ok: true; run: any };
  expect(r.run.targetId).toBe("t102");
  expect(r.run.steps[0].orderId).toBe(p.id);
  expect(target("t102").status).toBe("engaged");

  store.state = fixtureState();
  setPreset(1, "duel");
  const d = propose(1, "u1", "t104");
  const rd = go(d) as { ok: true; run: any };
  expect(rd.run.steps.map((s: any) => s.nodeId)).toEqual(["implementer1", "implementer2"]);
  expect(rd.run.steps[0].orderId).toBe(d.id);
  expect(rd.run.steps[1].orderId).not.toBe(d.id);
  expect(active().map((o) => o.unitId).sort()).toEqual(["u1", "u2"]);
});

test("W3: a team that lost its workflow fails the proposal; cancelling the reused step cancels the run", () => {
  setPreset(1, "trio");
  const p = propose(1, "u1", "t101");
  team(1).workflow = null;
  expect(go(p)).toEqual({ ok: false, error: "team Red has no workflow" });
  expect(p.status).toBe("failed");
  expect(store.state.workflowRuns).toEqual([]);

  store.state = fixtureState();
  setPreset(1, "trio");
  const q = propose(1, "u1", "t101");
  const r = (go(q) as { ok: true; run: any }).run;
  endOrder(q, "cancelled");
  expect(r.status).toBe("cancelled");
  expect(target("t101").status).toBe("open");
});
