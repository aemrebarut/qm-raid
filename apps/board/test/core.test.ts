// Smoke test for src/core: store reducer, feeds, bus selection. Run: bun test test/
import { test, expect } from "bun:test";
import { createStore, createBus, fixtureState, type EngineEvent } from "../src/core";

test("fixture matches the contract shape", () => {
  const s = fixtureState();
  expect(s.components.length).toBeGreaterThan(0);
  expect(s.buildings.map((b) => b.kind).sort()).toEqual(["barracks", "gbrain", "river"]);
  for (const t of s.targets) expect(typeof t.issue).toBe("string");
  for (const u of s.units) expect(u.pos.x).toBeLessThan(24);
});

test("store applies engine events and keeps feeds", () => {
  const store = createStore(fixtureState());
  const seen: string[] = [];
  let changes = 0;
  store.onEvent((ev) => seen.push(ev.type));
  store.subscribe(() => changes++);
  const evs: EngineEvent[] = [
    { seq: 1, ts: 1, type: "unit.moved", unitId: "u2", pos: { x: 10, y: 10 } },
    { seq: 2, ts: 2, type: "unit.status", unitId: "u2", status: "working" },
    { seq: 3, ts: 3, type: "unit.activity", unitId: "u2", kind: "tool", text: "read page", tool: "gbrain.get_page", args: { slug: "components/billing" } },
    { seq: 4, ts: 4, type: "memory.remember", unitId: "u2", slug: "learnings/lum-12-u2-4", summary: "use idempotency keys" },
    { seq: 5, ts: 5, type: "order.updated", order: { id: "o1", unitId: "u1", targetId: "t12", status: "done", source: "user", vetoDeadline: null, reply: "Fixed" } },
    { seq: 6, ts: 6, type: "stats", spentUsd: 1.5, tokens: 99 },
    { seq: 7, ts: 7, type: "forge.updated", unitType: { id: "forge-triager", name: "Triager", source: "forge", status: "ready", progress: 1, stage: "ready", model: "river/x" } },
  ];
  for (const ev of evs) store.apply(ev);
  store.apply({ type: "no.such.event" } as any); // ignored, no throw
  const s = store.getState();
  expect(store.unit("u2")!.pos).toEqual({ x: 10, y: 10 });
  expect(store.unit("u2")!.status).toBe("working");
  expect(s.memory.pages).toBe(43);
  expect(store.order("o1")!.reply).toBe("Fixed");
  expect(s.stats.tokens).toBe(99);
  expect(s.unitTypes.find((t) => t.id === "forge-triager")!.status).toBe("ready");
  expect(store.feed("u2").map((f) => f.kind)).toEqual(["tool", "remember"]);
  expect(store.feed("u2").map((f) => f.slugs)).toEqual([["components/billing"], ["learnings/lum-12-u2-4"]]);
  expect(store.feed("u1").map((f) => f.kind)).toEqual(["order", "reply"]);
  expect(seen.length).toBe(8); // unknown events still reach onEvent listeners
  expect(changes).toBeGreaterThanOrEqual(7);
});

test("snapshot replaces state", () => {
  const store = createStore(fixtureState());
  const snap = fixtureState();
  snap.units = snap.units.slice(0, 1);
  store.apply({ type: "state.snapshot", state: snap });
  expect(store.getState().units.length).toBe(1);
});

test("bus selection and focus", () => {
  const bus = createBus();
  const got: string[] = [];
  bus.on("selection", (s) => got.push(String(s.focus)));
  bus.select(["u1"]);
  bus.select(["u2"], { add: true });
  expect(bus.selection.units).toEqual(["u1", "u2"]);
  bus.selectTarget("t12");
  expect(bus.selection.units).toEqual(["u1", "u2"]);
  expect(bus.selection.focus).toBe("target");
  bus.selectBuilding("library");
  expect(bus.selection.units).toEqual([]);
  bus.clear();
  expect(got).toEqual(["units", "units", "target", "building", "null"]);
});

test("unit.retired removes the unit and drops it from selection", async () => {
  const { linkSelection } = await import("../src/core");
  const store = createStore(fixtureState());
  const bus = createBus();
  linkSelection(store, bus);
  bus.select(["u1", "u2"]);
  store.apply({ seq: 1, ts: 1, type: "unit.retired", unitId: "u1" });
  expect(store.unit("u1")).toBeUndefined();
  expect(store.team(1)!.members).not.toContain("u1");
  expect(bus.selection.units).toEqual(["u2"]);
});

test("snapshot backfills empty feeds from memory ops and replies", () => {
  const store = createStore(fixtureState());
  const snap = fixtureState();
  snap.orders[0]!.status = "done";
  snap.orders[0]!.reply = "Fixed it";
  store.apply({ seq: 1, ts: 1, type: "state.snapshot", state: snap });
  expect(store.feed("u1").map((f) => f.kind)).toEqual(["recall", "reply"]);
  expect(store.feed("u3").map((f) => f.kind)).toEqual(["remember"]);
  store.apply({ seq: 2, ts: 2, type: "state.snapshot", state: snap }); // no duplicates on a second snapshot
  expect(store.feed("u1").length).toBe(2);
});
