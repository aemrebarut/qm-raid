// Unit regressions for game rules, no services needed: cd services/engine && bun test
import { beforeEach, expect, test } from "bun:test";
import type { Order } from "../../../contract/types.ts";

// Bridge and brain calls succeed without a network; /propose answers with `proposeAnswer`.
let proposeAnswer: unknown = { proposals: [] };
let proposeGate: Promise<void> | null = null; // when set, /propose waits for it (a slow proposer)
const calls: { url: string; body: any }[] = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  calls.push({ url: String(url), body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
  if (String(url).endsWith("/propose") && proposeGate) await proposeGate;
  return new Response(JSON.stringify(String(url).endsWith("/propose") ? proposeAnswer : { ok: true }), { status: 200 });
}) as unknown as typeof fetch;
const VETO = `/tmp/engine-test-vetoes-${process.pid}.jsonl`;
process.env.VETO_LOG = VETO;

const { store } = await import("../src/store.ts");
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
  expect(Math.max(Math.abs(sp.unit.pos.x - 20), Math.abs(sp.unit.pos.y - 20))).toBe(1);
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
