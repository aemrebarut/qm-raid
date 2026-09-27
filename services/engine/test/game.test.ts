// Unit regressions for game rules, no services needed: cd services/engine && bun test
import { beforeEach, expect, test } from "bun:test";
import type { Order } from "../../../contract/types.ts";

// Bridge and brain calls succeed without a network.
globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

const { store } = await import("../src/store.ts");
const { fixtureState } = await import("../src/fixture.ts");
const { createOrders, onBridgeEvent } = await import("../src/game.ts");

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
