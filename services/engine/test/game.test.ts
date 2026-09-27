// Unit regressions for game rules, no services needed: cd services/engine && bun test
import { beforeEach, expect, test } from "bun:test";
import type { Order } from "../../../contract/types.ts";

// Bridge and brain calls succeed without a network; /propose answers with `proposeAnswer`.
let proposeAnswer: unknown = { proposals: [] };
let proposeGate: Promise<void> | null = null; // when set, /propose waits for it (a slow proposer)
globalThis.fetch = (async (url: string) => {
  if (String(url).endsWith("/propose") && proposeGate) await proposeGate;
  return new Response(JSON.stringify(String(url).endsWith("/propose") ? proposeAnswer : { ok: true }), { status: 200 });
}) as unknown as typeof fetch;
const VETO = `/tmp/engine-test-vetoes-${process.pid}.jsonl`;
process.env.VETO_LOG = VETO;

const { store } = await import("../src/store.ts");
const { fixtureState } = await import("../src/fixture.ts");
const { createOrders, onBridgeEvent, resetWorld, autopilotTick, goOrder, adjustOrder, cancelOrder } = await import("../src/game.ts");
const { patchTeam, tick } = await import("../src/game.ts");

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
