// Unit regressions for game rules, no services needed: cd services/engine && bun test
import { beforeEach, expect, test } from "bun:test";
import type { Order } from "../../../contract/types.ts";

// Bridge and brain calls succeed without a network; /propose answers with `proposeAnswer`.
let proposeAnswer: unknown = { proposals: [] };
let proposeGate: Promise<void> | null = null; // when set, /propose waits for it (a slow proposer)
let spawnGate: Promise<void> | null = null; // when set, bridge POST /units waits for it (slow registration)
const calls: { url: string; body: any }[] = [];
let sessionGen = 0; // bridge POST /units answers a fresh sessionId each time
let brainResetGate: Promise<void> | null = null; // when set, brain POST /reset waits for it (slow reset)
const sendStatuses: number[] = []; // bridge POST /units/:id/send answers these statuses first (then 200)
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
  if (String(url).endsWith("/propose") && proposeGate) await proposeGate;
  if (String(url).endsWith("/units") && init?.method === "POST" && spawnGate) await spawnGate;
  if (String(url).endsWith("/reset") && brainResetGate) await brainResetGate;
  if (String(url).endsWith("/send") && sendStatuses.length) return new Response(JSON.stringify({ ok: false }), { status: sendStatuses.shift()! });
  if (String(url).endsWith("/units") && init?.method === "POST") {
    const id = `s${++sessionGen}`;
    return new Response(JSON.stringify({ sessionId: id, sessionUrl: `http://qm.test/c/${id}` }), { status: 200 });
  }
  return new Response(JSON.stringify(String(url).endsWith("/propose") ? proposeAnswer : { ok: true }), { status: 200 });
}) as unknown as typeof fetch;
const VETO = `/tmp/engine-test-vetoes-${process.pid}.jsonl`;
process.env.VETO_LOG = VETO;

const { store, recentEvents } = await import("../src/store.ts");
const { fixtureState } = await import("../src/fixture.ts");
const { createOrders, onBridgeEvent, resetWorld, autopilotTick, goOrder, adjustOrder, cancelOrder } = await import("../src/game.ts");
const game = await import("../src/game.ts");
const { patchTeam, tick } = game;

const unit = (id: string) => store.state.units.find((u) => u.id === id)!;
const order = (id: string) => store.state.orders.find((o) => o.id === id)!;
const orderFor = (unitIds: string[], targetId: string) => (createOrders({ unitIds, targetId }) as { orders: Order[] }).orders[0]!;

beforeEach(() => { store.state = fixtureState(); });

test("a reply without orderId never finishes the active order (chat reply)", () => {
  const o = orderFor(["u1"], "t101");
  onBridgeEvent({ type: "reply", unitId: "u1", text: "reply to a direct message" });
  expect(order(o.id).status).toBe("active");
  expect(unit("u1").orderId).toBe(o.id);
  onBridgeEvent({ type: "error", unitId: "u1", text: "chat failed" });
  expect(order(o.id).status).toBe("active");
  onBridgeEvent({ type: "reply", unitId: "u1", orderId: o.id, text: "fixed" });
  expect(order(o.id).status).toBe("done");
  expect(order(o.id).reply).toBe("fixed");
  expect(unit("u1").status).toBe("idle");
});

test("stale terminal events and stale gbrain calls do not touch the replacement order or a walking unit", () => {
  const old = orderFor(["u2"], "t101");
  const next = orderFor(["u2"], "t105");
  expect(order(old.id).status).toBe("cancelled");
  expect(unit("u2").status).toBe("moving");
  onBridgeEvent({ type: "activity", unitId: "u2", orderId: old.id, kind: "tool", text: "recall", tool: "gbrain.recall", args: { componentId: "billing" } });
  onBridgeEvent({ type: "activity", unitId: "u2", orderId: old.id, kind: "tool", text: "remember", tool: "gbrain.remember", args: { slug: "learnings/x" } });
  expect(unit("u2").status).toBe("moving");
  onBridgeEvent({ type: "reply", unitId: "u2", orderId: old.id, text: "late" });
  onBridgeEvent({ type: "error", unitId: "u2", orderId: old.id, text: "late error" });
  expect(order(next.id).status).toBe("active");
  expect(order(old.id).status).toBe("cancelled");
  // A chat recall while walking is shown in memory but does not stop the walk.
  onBridgeEvent({ type: "activity", unitId: "u2", kind: "tool", text: "recall", tool: "gbrain_recall", args: {} });
  expect(unit("u2").status).toBe("moving");
});

test("chat gbrain calls on an idle unit animate and return to idle", async () => {
  onBridgeEvent({ type: "activity", unitId: "u3", kind: "tool", text: "recall", tool: "mcp__gbrain__recall", args: { targetId: "t106" } });
  expect(unit("u3").status).toBe("recalling");
  const op = store.state.memory.recent.at(-1)!;
  expect(op.op).toBe("recall");
  expect(op.slugs).toEqual(["issues/lum-106", "companies/acme-robotics", "companies/orchard-education"]);
  await Bun.sleep(1700);
  expect(unit("u3").status).toBe("idle");
});

test("gbrain classifier maps link, write and read tools", () => {
  onBridgeEvent({ type: "activity", unitId: "u4", kind: "tool", text: "l", tool: "gbrain.add_link", args: { from: "a/b", to: "c/d" } });
  onBridgeEvent({ type: "activity", unitId: "u4", kind: "tool", text: "w", tool: "mcp__gbrain__put_page", args: { slug: "learnings/y" } });
  onBridgeEvent({ type: "activity", unitId: "u4", kind: "tool", text: "r", tool: "gbrain.get_page", args: { slug: "components/auth" } });
  expect(store.state.memory.recent.slice(-3).map((m) => m.op)).toEqual(["link", "remember", "recall"]);
});

test("order ids stay unique across reset, so a late pre-reset reply cannot finish a new order", async () => {
  const before = orderFor(["u1"], "t101");
  await resetWorld();
  const after = orderFor(["u1"], "t102");
  expect(after.id).not.toBe(before.id);
  onBridgeEvent({ type: "reply", unitId: "u1", orderId: before.id, text: "late pre-reset reply" });
  expect(order(after.id).status).toBe("active");
});

test("nested MCP args {mcpServer, args} are unwrapped for slugs", () => {
  onBridgeEvent({ type: "activity", unitId: "u5", kind: "tool", text: "r", tool: "gbrain.recall", args: { mcpServer: "gbrain", args: { componentId: "auth" } } });
  expect(store.state.memory.recent.at(-1)!.slugs).toEqual(["components/auth"]);
});

test("autopilot proposes, and go / adjust / cancel / expiry each resolve and log one veto row", async () => {
  const { rmSync, readFileSync } = await import("node:fs");
  rmSync(VETO, { force: true });
  patchTeam(1, { autopilot: true });
  proposeAnswer = { proposals: [
    { unitId: "u1", targetId: "t101", reason: "sev 3" },
    { unitId: "u2", targetId: "t101", reason: "duplicate target, skipped" },
    { unitId: "u2", targetId: "t104", reason: "sev 3 auth" },
    { unitId: "u3", targetId: "t106", reason: "sev 2" },
    { unitId: "u4", targetId: "t108", reason: "not an autopilot team, skipped" },
  ] };
  await autopilotTick();
  const proposed = store.state.orders.filter((o) => o.status === "proposed");
  expect(proposed.map((o) => o.unitId)).toEqual(["u1", "u2", "u3"]);
  expect(unit("u1").status).toBe("waiting_approval");
  expect(proposed[0]!.vetoDeadline! - Date.now()).toBeGreaterThan(14000);
  const [a, b, c] = proposed;
  expect(goOrder(a!.id).ok).toBe(true);
  expect(order(a!.id).status).toBe("active");
  expect(unit("u1").status).toBe("moving");
  expect(adjustOrder(b!.id, { targetId: "t105" }).ok).toBe(true);
  expect(order(b!.id).targetId).toBe("t105");
  expect(order(b!.id).status).toBe("active");
  expect(cancelOrder(c!.id).ok).toBe(true);
  expect(unit("u3").status).toBe("idle");
  expect(goOrder(c!.id).ok).toBe(false);
  // Expiry: next proposal with a past deadline activates on the tick.
  proposeAnswer = { proposals: [{ unitId: "u3", targetId: "t107", reason: "sev 2" }] };
  await autopilotTick();
  const d = store.state.orders.find((o) => o.status === "proposed")!;
  d.vetoDeadline = Date.now() - 1;
  tick();
  expect(order(d.id).status).toBe("active");
  await Bun.sleep(100);
  const rows = readFileSync(VETO, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(rows.map((r) => r.action)).toEqual(["go", "adjust", "cancel", "expired"]);
  expect(rows[1].adjustedTo).toEqual({ targetId: "t105" });
  expect(rows[0].proposal).toEqual({ unitId: "u1", targetId: "t101", reason: "sev 3" });
  expect(rows[0].context.units.length).toBe(3);
  proposeAnswer = { proposals: [] };
});

test("a plain gbrain search naming a component recalls its page", () => {
  onBridgeEvent({ type: "activity", unitId: "u6", kind: "tool", text: "s", tool: "gbrain.search", args: { query: "billing retries" } });
  expect(store.state.memory.recent.at(-1)!.slugs).toEqual(["components/billing"]);
});

test("a proposal for a target that got a manual order while the proposer was thinking is dropped", async () => {
  patchTeam(1, { autopilot: true });
  let release!: () => void;
  proposeGate = new Promise<void>((r) => { release = r; });
  proposeAnswer = { proposals: [{ unitId: "u1", targetId: "t101", reason: "sev 3" }, { unitId: "u2", targetId: "t104", reason: "sev 3" }] };
  const pending = autopilotTick();
  await Bun.sleep(10);
  const manual = orderFor(["u4"], "t101");
  release();
  await pending;
  proposeGate = null;
  proposeAnswer = { proposals: [] };
  const onT101 = store.state.orders.filter((o) => o.targetId === "t101" && (o.status === "active" || o.status === "proposed"));
  expect(onT101.map((o) => o.id)).toEqual([manual.id]);
  expect(unit("u1").status).toBe("idle");
  expect(store.state.orders.find((o) => o.unitId === "u2")?.status).toBe("proposed");
});

test("E16: on the mock backend a gbrain.remember is mirrored to brain /remember with the slug", async () => {
  const o = orderFor(["u5"], "t104");
  calls.length = 0;
  onBridgeEvent({ type: "activity", unitId: "u5", orderId: o.id, kind: "tool", text: "Remembering", tool: "gbrain.remember", args: { slug: "learnings/lum-104-u5-1", text: "skew rule" } });
  await Bun.sleep(20);
  const m = calls.find((c) => c.url.endsWith("/remember"));
  expect(m?.body).toEqual({ unitId: "u5", targetId: "t104", text: "skew rule", slug: "learnings/lum-104-u5-1" });
});

test("E9 control groups and team orders; E13 Barracks spawn", () => {
  const { assignTeam, spawnUnit } = game;
  expect(assignTeam({ id: 3, members: ["u1", "u6"] }).ok).toBe(true);
  const t3 = store.state.teams.find((t) => t.id === 3)!;
  expect(t3).toMatchObject({ name: "Green", color: "#3fa34d", members: ["u1", "u6"] });
  expect(store.state.teams.find((t) => t.id === 1)!.members).toEqual(["u2", "u3"]);
  expect(unit("u1").team).toBe(3);
  const res = createOrders({ teamId: 3, targetId: "t108" }) as { ok: boolean; orders: Order[] };
  expect(res.orders.map((o) => o.unitId)).toEqual(["u1", "u6"]);
  const sp = spawnUnit({ class: "scout", team: 5 }) as { ok: boolean; unit: any };
  expect(sp.ok).toBe(true);
  expect(sp.unit).toMatchObject({ class: "scout", model: "gpt-6-luna", effort: "low", team: 5, status: "idle" });
  expect(sp.unit.pos).toEqual({ x: 20, y: 22 }); // Barracks door row, outside its 3 x 3 footprint
  expect(store.state.teams.find((t) => t.id === 5)).toMatchObject({ color: "#888888", members: [sp.unit.id] });
  expect(spawnUnit({ class: "wizard" }).ok).toBe(false);
});

test("M5: reset returns the exact demo start and leaves the veto log alone", async () => {
  const { writeFileSync, readFileSync } = await import("node:fs");
  const { fixtureUnits } = await import("../src/fixture.ts");
  writeFileSync(VETO, '{"action":"go"}\n');
  orderFor(["u1"], "t101");
  onBridgeEvent({ type: "reply", unitId: "u1", orderId: store.state.orders[0]!.id, text: "done" });
  orderFor(["u2"], "t102");
  patchTeam(1, { autopilot: true, name: "Renamed" });
  game.assignTeam({ id: 3, members: ["u4"] });
  game.spawnUnit({ class: "knight", team: 2 });
  onBridgeEvent({ type: "usage", unitId: "u2", tokens: 500, usd: 0.01 });
  onBridgeEvent({ type: "activity", unitId: "u3", kind: "tool", text: "r", tool: "gbrain.recall", args: {} });
  calls.length = 0;
  await resetWorld();
  const fresh = fixtureState();
  const pick = (u: any) => ({ id: u.id, pos: u.pos, status: u.status, team: u.team, orderId: u.orderId, class: u.class, model: u.model });
  expect(store.state.units.map(pick)).toEqual(fixtureUnits().map(pick));
  expect(store.state.targets.every((t) => t.status === "open")).toBe(true);
  expect(store.state.targets.length).toBe(fresh.targets.length);
  expect(store.state.teams).toEqual(fresh.teams);
  expect(store.state.teams.every((t) => !t.autopilot)).toBe(true);
  expect(store.state.orders).toEqual([]);
  expect(store.state.memory.recent).toEqual([]);
  expect(store.state.stats).toEqual({ spentUsd: 0, tokens: 0 });
  expect(readFileSync(VETO, "utf8")).toBe('{"action":"go"}\n');
  expect(calls.some((c) => c.url.endsWith("/reset"))).toBe(true); // BRAIN_RESET defaults to on
  expect(calls.filter((c) => /\/units\/u\d+$/.test(c.url)).length).toBeGreaterThanOrEqual(7); // bridge DELETE per old unit
});

test("SSE: a client that stops reading is dropped instead of buffering forever; a reading client stays", async () => {
  const { sseResponse } = await import("../src/sse.ts");
  const { emit, listenerCount } = await import("../src/store.ts");
  const base = listenerCount();
  const slow = sseResponse(new Request("http://x/api/events"), {});
  const fast = sseResponse(new Request("http://x/api/events"), {});
  const reader = fast.body!.getReader();
  let got = 0;
  const pump = (async () => { for (;;) { const r = await reader.read(); if (r.done) break; got++; } })();
  expect(listenerCount()).toBe(base + 2);
  for (let i = 0; i < 2100; i++) {
    emit("unit.moved", { unitId: "u1", pos: { x: i % 24, y: 0 } });
    if (i % 100 === 0) await Bun.sleep(0);
  }
  await Bun.sleep(10);
  expect(listenerCount()).toBe(base + 1);
  expect(got).toBeGreaterThan(2000);
  await reader.cancel();
  await pump;
  expect(listenerCount()).toBe(base);
  void slow;
});

test("CORS allowlist and CSRF guards", async () => {
  const { handle } = await import("../src/app.ts");
  const board = "http://127.0.0.1:4611";
  const evil = "https://evil.example";
  const pre = await handle(new Request("http://e/api/orders", { method: "OPTIONS", headers: { origin: board } }));
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-origin")).toBe(board);
  const read = await handle(new Request("http://e/api/state", { headers: { origin: evil } }));
  expect(read.headers.get("access-control-allow-origin")).toBeNull();
  const preEvil = await handle(new Request("http://e/api/orders", { method: "OPTIONS", headers: { origin: evil } }));
  expect(preEvil.headers.get("access-control-allow-origin")).toBeNull();
  // Bodyless no-cors POST from another site: refused before it can reset or order anything.
  const csrf = await handle(new Request("http://e/api/reset", { method: "POST", headers: { origin: evil } }));
  expect(csrf.status).toBe(403);
  const form = await handle(new Request("http://e/api/orders", { method: "POST", headers: { "content-type": "text/plain" }, body: '{"unitIds":["u1"],"targetId":"t101"}' }));
  expect(form.status).toBe(415);
  expect(store.state.orders.length).toBe(0);
  const ok = await handle(new Request("http://e/api/orders", { method: "POST", headers: { origin: board, "content-type": "application/json" }, body: '{"unitIds":["u1"],"targetId":"t101"}' }));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("access-control-allow-origin")).toBe(board);
  // The board posts bodyless commands without a content-type.
  const cancel = await handle(new Request(`http://e/api/orders/${store.state.orders[0]!.id}/cancel`, { method: "POST", headers: { origin: board } }));
  expect(cancel.status).toBe(200);
  const noOrigin = await handle(new Request("http://e/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: '{"unitIds":["u2"],"targetId":"t102"}' }));
  expect(noOrigin.status).toBe(200); // curl, tests and services send no Origin
  for (const o of ["http://127.0.0.1:4619", "http://localhost:4619", "http://127.0.0.1:4621", "http://localhost:4621"]) {
    const r = await handle(new Request("http://e/api/orders", { method: "OPTIONS", headers: { origin: o } }));
    expect(r.headers.get("access-control-allow-origin")).toBe(o); // test board and frozen demo board
  }
});

for (const action of ["retire", "cancel", "reset"] as const) {
  test(`P1: a slow bridge registration never sends a ${action}ed order`, async () => {
    let release!: () => void;
    spawnGate = new Promise<void>((r) => { release = r; });
    const u = (game.spawnUnit({ class: "ranger" }) as { unit: any }).unit;
    const live = unit(u.id);
    live.pos = { x: 4, y: 4 }; // next to t101 (3,3): arrives on the first tick
    const o = orderFor([u.id], "t101");
    game.tick();
    expect(live.status).toBe("working");
    calls.length = 0;
    if (action === "retire") game.retireUnit(u.id);
    if (action === "cancel") cancelOrder(o.id);
    if (action === "reset") await resetWorld();
    release();
    spawnGate = null;
    await Bun.sleep(30);
    expect(calls.filter((c) => c.url.endsWith(`/units/${u.id}/send`))).toEqual([]);
    if (action === "retire") expect(calls.some((c) => c.url.endsWith(`/units/${u.id}`))).toBe(true); // late session deleted
  });
}

test("F2: workflow wiring with a fake flow (routes, run start, prompt brief, step ends, cancel, autopilot skip)", async () => {
  const { useFlow } = await import("../src/flowlink.ts");
  const { handle } = await import("../src/app.ts");
  let hooks: any;
  const ended: Order[] = [];
  const cancelled: string[] = [];
  const trio = { preset: "trio", entry: "plan", maxLoops: 2, edges: [], nodes: [
    { id: "plan", role: "planner", unitId: "u1" }, { id: "impl", role: "implementer", unitId: "u2" }, { id: "rev", role: "reviewer", unitId: "u3" }] };
  const run: any = { id: "r1", teamId: 1, targetId: "t101", status: "running", loops: 0, active: [], steps: [] };
  useFlow({
    initWorkflows: (h) => { hooks = h; },
    presetWorkflow: (preset, members) => (preset === "trio" && members.length >= 3 ? (trio as any) : { error: "trio needs 3 members" }),
    validateWorkflow: () => null,
    startRun: (teamId, targetId) => {
      const id = hooks.startOrder("u1", targetId, { runId: "r1", nodeId: "plan", role: "planner", instructions: "Write a plan.", previous: [] });
      run.active = [id];
      return { ok: true, run };
    },
    onOrderEnded: (o) => {
      ended.push({ ...o });
      if (o.nodeId === "plan" && o.status === "done")
        run.active = [hooks.startOrder("u2", o.targetId, { runId: "r1", nodeId: "impl", role: "implementer", instructions: "Build it.", previous: [{ nodeId: "plan", role: "planner", unitId: "u1", reply: "1. step" }] })];
    },
    cancelRun: (id) => { cancelled.push(id); run.status = "cancelled"; for (const oid of run.active) hooks.cancelOrder(oid); return { ok: true }; },
    runForOrder: (oid) => (store.state.orders.find((o) => o.id === oid)?.runId === "r1" ? run : undefined),
  });
  const put = async (body: unknown) => handle(new Request("http://e/api/teams/1/workflow", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect((await put({ preset: "trio" })).status).toBe(200);
  expect(store.state.teams[0]!.workflow?.preset).toBe("trio");
  expect((await put({ preset: "nope" })).status).toBe(400);
  // Team order on a workflow team starts a run instead of three orders.
  const res = createOrders({ teamId: 1, targetId: "t101" }) as any;
  expect(res.run.id).toBe("r1");
  const first = store.state.orders.at(-1)!;
  expect(first).toMatchObject({ unitId: "u1", source: "workflow", runId: "r1", nodeId: "plan", status: "active" });
  expect(store.state.orders.filter((o) => o.status === "active").length).toBe(1);
  // Arrival sends the normal prompt plus the role brief.
  for (let i = 0; i < 30 && unit("u1").status === "moving"; i++) game.tick();
  expect(unit("u1").status).toBe("working");
  await Bun.sleep(20);
  // Step done: target stays engaged (next node started), not resolved.
  onBridgeEvent({ type: "reply", unitId: "u1", orderId: first.id, text: "1. step" });
  expect(ended.at(-1)).toMatchObject({ id: first.id, status: "done", reply: "1. step" });
  const second = store.state.orders.at(-1)!;
  expect(second).toMatchObject({ unitId: "u2", nodeId: "impl" });
  expect(store.state.targets.find((t) => t.id === "t101")!.status).toBe("engaged");
  // Brief text of the second order reaches the bridge.
  calls.length = 0;
  for (let i = 0; i < 30 && unit("u2").status === "moving"; i++) game.tick();
  await Bun.sleep(20);
  const sent = calls.find((c) => c.url.endsWith("/units/u2/send"))!.body.text as string;
  expect(sent).toContain("Order " + second.id);
  expect(sent).toContain("Role: implementer. Build it.");
  expect(sent).toContain("Previous work:\n- planner (u1): 1. step");
  // Cancelling a run order cancels the run.
  const c = await handle(new Request(`http://e/api/orders/${second.id}/cancel`, { method: "POST" }));
  expect(c.status).toBe(200);
  expect(cancelled).toEqual(["r1"]);
  expect(order(second.id).status).toBe("cancelled");
  expect(unit("u2").status).toBe("idle");
  // Autopilot skips workflow teams.
  patchTeam(1, { autopilot: true });
  proposeAnswer = { proposals: [{ unitId: "u1", targetId: "t102", reason: "x" }] };
  await autopilotTick();
  expect(store.state.orders.some((o) => o.source === "autopilot")).toBe(false);
  proposeAnswer = { proposals: [] };
  // DELETE clears; a bound unit leaving the team clears too.
  expect((await handle(new Request("http://e/api/teams/1/workflow", { method: "DELETE" }))).status).toBe(200);
  expect(store.state.teams[0]!.workflow).toBeNull();
  await put({ preset: "trio" });
  game.assignTeam({ id: 2, members: ["u4", "u5", "u3"] });
  expect(store.state.teams[0]!.workflow).toBeNull();
});

test("bridge reconnect re-registers idle units with fresh sessions; units mid-order keep the lazy path", async () => {
  const { BRIDGE_URL } = await import("../src/config.ts");
  const o = orderFor(["u2"], "t101");
  game.resyncUnits(BRIDGE_URL); // first connect
  await Bun.sleep(20);
  const first = unit("u1").qm.sessionId;
  expect(first).toBeTruthy();
  calls.length = 0;
  game.resyncUnits(BRIDGE_URL); // bridge restarted: SSE reconnect
  await Bun.sleep(20);
  const posted = calls.filter((c) => c.url === `${BRIDGE_URL}/units`).map((c) => c.body.id).sort();
  expect(posted).toEqual(["u1", "u3", "u4", "u5", "u6"]);
  expect(unit("u1").qm.sessionId).not.toBe(first);
  expect(unit("u1").qm.sessionUrl).toBe(`http://qm.test/c/${unit("u1").qm.sessionId}`);
  expect(recentEvents().some((e: any) => e.type === "unit.updated" && e.unit.id === "u1" && e.unit.qm.sessionId === unit("u1").qm.sessionId)).toBe(true);
  expect(order(o.id).status).toBe("active");
});

test("a direct message re-registers the unit after a bridge 404 and retries once", async () => {
  const { messageUnit } = game;
  game.resyncUnits((await import("../src/config.ts")).BRIDGE_URL);
  await Bun.sleep(20);
  calls.length = 0;
  sendStatuses.push(404);
  expect(await messageUnit("u6", { text: "status?" })).toEqual({ ok: true });
  expect(calls.map((c) => c.url.replace(/^http:\/\/[^/]+/, ""))).toEqual(["/units/u6/send", "/units", "/units/u6/send"]);
  sendStatuses.push(404, 404);
  const r = await messageUnit("u6", { text: "again?" });
  expect(r.ok).toBe(false);
  sendStatuses.length = 0;
});

test("P1: a reset in flight kills a trio run: a planner reply during brain /reset starts and sends nothing", async () => {
  const { useFlow } = await import("../src/flowlink.ts");
  const { handle } = await import("../src/app.ts");
  useFlow(await import("../src/workflow.ts"));
  expect(game.setTeamWorkflow(1, { preset: "trio" }).ok).toBe(true);
  expect(createOrders({ teamId: 1, targetId: "t101" }).ok).toBe(true);
  const o1 = store.state.orders.find((o) => o.source === "workflow" && o.status === "active")!;
  const planner = unit(o1.unitId);
  for (let i = 0; i < 40 && planner.status === "moving"; i++) tick();
  await Bun.sleep(20);
  expect(calls.some((c) => c.url.endsWith(`/units/${planner.id}/send`) && c.body.orderId === o1.id)).toBe(true);

  let open!: () => void;
  brainResetGate = new Promise((r) => (open = r));
  calls.length = 0;
  const seq0 = recentEvents().at(-1)!.seq;
  const reset = resetWorld();
  await Bun.sleep(10);
  onBridgeEvent({ type: "reply", unitId: planner.id, orderId: o1.id, text: "1. plan the fix" });
  for (let i = 0; i < 40; i++) tick();
  const post = (path: string, body: unknown) => handle(new Request(`http://127.0.0.1:4610${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  expect((await post("/api/orders", { unitIds: ["u6"], targetId: "t102" })).status).toBe(409);
  expect((await post("/api/reset", {})).status).toBe(409);
  await Bun.sleep(20);
  open();
  brainResetGate = null;
  expect((await reset).ok).toBe(true);
  await Bun.sleep(20);

  expect(calls.filter((c) => c.url.endsWith("/send"))).toEqual([]);
  const after = recentEvents().filter((e: any) => e.seq > seq0).map((e: any) => e.type);
  expect(after.filter((t: string) => t.startsWith("workflow.") || t === "order.updated" || t === "unit.moved")).toEqual([]);
  expect(store.state.orders).toEqual([]);
  expect(store.state.workflowRuns).toEqual([]);
  expect((await post("/api/orders", { unitIds: ["u6"], targetId: "t102" })).status).toBe(200);
});

test("spawn tiles: builtins at the Barracks door, forged at the Forge door, never on buildings or zone walls", () => {
  const { spawnUnit } = game;
  const onBuilding = (p: any) => store.state.buildings.some((b) => Math.abs(b.x - p.x) <= 1 && Math.abs(b.y - p.y) <= 1);
  const onWall = (p: any) => store.state.components.some(({ zone: z }) => p.x >= z.x && p.x < z.x + z.w && p.y >= z.y && p.y < z.y + z.h
    && (p.x === z.x || p.x === z.x + z.w - 1 || p.y === z.y || p.y === z.y + z.h - 1));
  store.state.unitTypes.push({ id: "forge-scribe", name: "Scribe", source: "forge", status: "ready", progress: 1, stage: "ready", model: "river-1" });
  const forged = (spawnUnit({ class: "forge-scribe" }) as any).unit;
  expect(forged.pos).toEqual({ x: 3, y: 22 });
  const spawned = Array.from({ length: 12 }, () => (spawnUnit({ class: "knight" }) as any).unit);
  const tiles = new Set(spawned.map((u) => `${u.pos.x},${u.pos.y}`));
  expect(tiles.size).toBe(12);
  for (const u of [forged, ...spawned]) expect(onBuilding(u.pos) || onWall(u.pos)).toBe(false);
  expect(spawned.every((u) => Math.abs(u.pos.x - 20) <= 4 && u.pos.y >= 19)).toBe(true);

  // A unit left inside a footprint (old spawn) or on a wall steps off on the next tick and says so.
  unit("u6").pos = { x: 19, y: 19 };
  unit("u5").pos = { x: 1, y: 3 };
  tick();
  expect(onBuilding(unit("u6").pos) || onWall(unit("u6").pos)).toBe(false);
  expect(onBuilding(unit("u5").pos) || onWall(unit("u5").pos)).toBe(false);
  expect(recentEvents().filter((e: any) => e.type === "unit.moved").slice(-2).map((e: any) => e.unitId).sort()).toEqual(["u5", "u6"]);

  // Order destinations next to a target skip zone walls.
  for (const t of store.state.targets) {
    const o = orderFor(["u4"], t.id);
    for (let i = 0; i < 60 && unit("u4").status === "moving"; i++) tick();
    expect(onWall(unit("u4").pos) || onBuilding(unit("u4").pos)).toBe(false);
    game.cancelOrder(o.id);
  }
});
