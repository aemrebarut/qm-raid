// K13 spawnTarget against a fake brain (fetch stub, no network, no live engine): cd services/engine && bun test test/targets.test.ts
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Pos, Target } from "../../../contract/types.ts";

// Fake brain POST /issues: allocates LUM-<next> / t<next> like the real one, echoes the fields it got.
type Call = { url: string; body: any };
let calls: Call[] = [];
let next = 110;
let mode: "ok" | "down" | "500" | "409" | "noTarget" = "ok";
let gate: Promise<void> | null = null;
let forceId: string | null = null;
const realFetch = globalThis.fetch;
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ url: String(url), body });
  if (gate) await gate;
  if (mode === "down") throw new TypeError("fetch failed: connection refused");
  if (mode === "500") return new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 });
  if (mode === "409") return new Response(JSON.stringify({ ok: false, error: "issue pool exhausted; POST /reset refills it" }), { status: 409 });
  if (mode === "noTarget") return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const n = next++;
  const target = {
    id: forceId ?? `t${n}`, issue: `LUM-${n}`, title: body.title ?? "Pool issue: webhook retries flood the audit log",
    component: body.component, kind: body.kind ?? "bug", severity: body.severity ?? 2, status: "open", pos: body.pos, customers: body.customers ?? ["acme-robotics"],
  };
  return new Response(JSON.stringify({ ok: true, target }), { status: 200 });
}) as unknown as typeof fetch;
beforeAll(() => { globalThis.fetch = fakeFetch; });
afterAll(() => { globalThis.fetch = realFetch; });

const { store, recentEvents } = await import("../src/store.ts");
const { fixtureState } = await import("../src/fixture.ts");
const { spawnTarget, leastBusy } = await import("../src/targets.ts");

beforeEach(() => {
  globalThis.fetch = fakeFetch;
  store.state = fixtureState();
  calls = []; next = 110; mode = "ok"; gate = null; forceId = null;
});

const zoneOf = (c: string) => store.state.components.find((x) => x.id === c)!.zone;
const inInterior = (c: string, p: Pos) => { const z = zoneOf(c); return p.x > z.x && p.x < z.x + z.w - 1 && p.y > z.y && p.y < z.y + z.h - 1; };
const onBuilding = (p: Pos) => store.state.buildings.some((b) => Math.abs(b.x - p.x) <= 1 && Math.abs(b.y - p.y) <= 1);
const spawned = () => recentEvents().filter((e: any) => e.type === "target.spawned");
const released = () => { let open!: () => void; gate = new Promise<void>((r) => (open = r)); return () => { gate = null; open(); }; };

test("form body: brain allocates the id, no issue id sent, target added and target.spawned emitted", async () => {
  const before = spawned().length;
  const r = await spawnTarget({ title: "Passkey prompt loops on Safari", body: "Users see the prompt twice.", component: "auth", kind: "feature", severity: 3, customers: ["kestrel-labs"] });
  expect(r.ok).toBe(true);
  const t = (r as { target: Target }).target;
  expect(t).toMatchObject({ id: "t110", issue: "LUM-110", title: "Passkey prompt loops on Safari", component: "auth", kind: "feature", severity: 3, status: "open", customers: ["kestrel-labs"] });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toEndWith("/issues");
  const sent = calls[0]!.body;
  expect(sent).toMatchObject({ title: "Passkey prompt loops on Safari", body: "Users see the prompt twice.", component: "auth", kind: "feature", severity: 3, customers: ["kestrel-labs"] });
  expect("issue" in sent || "id" in sent || "targetId" in sent).toBe(false);
  expect(sent.pos).toEqual(t.pos);
  expect(store.state.targets.find((x) => x.id === "t110")).toEqual(t);
  expect(spawned().length).toBe(before + 1);
  expect(spawned().at(-1).target).toEqual(t);
});

test("form defaults: component least busy, kind bug, severity 2", async () => {
  // fixture: billing 3 open, auth 2, onboarding 2, search 2; resolving onboarding makes it the least busy
  for (const t of store.state.targets) if (t.component === "onboarding") t.status = "resolved";
  expect(leastBusy(store.state)).toBe("onboarding");
  const r = await spawnTarget({ title: "Welcome checklist resets" });
  expect(r.ok).toBe(true);
  expect(calls[0]!.body).toMatchObject({ component: "onboarding", kind: "bug", severity: 2 });
  expect((r as any).target).toMatchObject({ component: "onboarding", kind: "bug", severity: 2 });
});

test("random (empty body, the HUD one-click): no title sent so the brain draws a pool issue; component least busy", async () => {
  // ties keep world order: auth, onboarding and search all have 2 open targets, billing 3
  const r = await spawnTarget({});
  expect(r.ok).toBe(true);
  expect(Object.keys(calls[0]!.body).sort()).toEqual(["component", "pos"]);
  expect(calls[0]!.body.component).toBe("auth");
  expect((r as any).target.title).toStartWith("Pool issue");
  expect((await spawnTarget(undefined)).ok).toBe(true); // no body at all is Random too
  expect((await spawnTarget({ title: "   " })).ok).toBe(true); // blank title is Random
  expect(calls[2]!.body.title).toBeUndefined();
});

test("free tile: inside the zone interior, never on a building, target or unit", async () => {
  // put a building into the search zone and fill every other free interior tile with units except one
  store.state.buildings.push({ id: "tower", kind: "gbrain", x: 19, y: 13 });
  const z = zoneOf("search");
  const keep = { x: 21, y: 11 };
  let n = 0;
  for (let y = z.y + 1; y < z.y + z.h - 1; y++) for (let x = z.x + 1; x < z.x + z.w - 1; x++) {
    const q = { x, y };
    if ((q.x === keep.x && q.y === keep.y) || onBuilding(q) || store.state.targets.some((t) => t.pos.x === x && t.pos.y === y)) continue;
    store.state.units.push({ ...store.state.units[0]!, id: `f${n++}`, pos: q });
  }
  const r = await spawnTarget({ title: "Cached facets leak", component: "search" });
  expect(r.ok).toBe(true);
  expect((r as any).target.pos).toEqual(keep);
  const full = await spawnTarget({ title: "Another", component: "search" });
  expect(full).toMatchObject({ ok: false, status: 409 });
  expect(calls).toHaveLength(1); // no brain call without a tile
});

test("20 spawns: every tile interior, off buildings, targets and units; ids unique", async () => {
  for (let i = 0; i < 20; i++) {
    const r = await spawnTarget({ component: ["billing", "auth", "onboarding", "search"][i % 4] });
    expect(r.ok).toBe(true);
    const t = (r as any).target as Target;
    expect(inInterior(t.component, t.pos)).toBe(true);
    expect(onBuilding(t.pos)).toBe(false);
    expect(store.state.units.some((u) => u.pos.x === t.pos.x && u.pos.y === t.pos.y)).toBe(false);
    expect(store.state.targets.filter((x) => x.pos.x === t.pos.x && x.pos.y === t.pos.y)).toHaveLength(1);
  }
  expect(new Set(store.state.targets.map((t) => t.id)).size).toBe(store.state.targets.length);
});

test("concurrent spawns: distinct tiles (reserved before the brain call) and distinct brain ids", async () => {
  const open = released();
  const a = spawnTarget({ title: "A", component: "billing" });
  const b = spawnTarget({ title: "B", component: "billing" });
  const c = spawnTarget({}); // least busy counts the two pending billing spawns too
  await Bun.sleep(5);
  expect(calls).toHaveLength(3);
  expect(calls[0]!.body.pos).not.toEqual(calls[1]!.body.pos);
  expect(calls[2]!.body.component).not.toBe("billing");
  open();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  expect([ra.ok, rb.ok, rc.ok]).toEqual([true, true, true]);
  const ids = [ra, rb, rc].map((r) => (r as any).target.id);
  expect(new Set(ids).size).toBe(3);
  expect(store.state.targets.filter((t) => ids.includes(t.id))).toHaveLength(3);
});

test("concurrent spawns on the last free tile: the second gets 409, not the same tile", async () => {
  const z = zoneOf("onboarding");
  const keep = { x: z.x + 3, y: z.y + 3 };
  let n = 0;
  for (let y = z.y + 1; y < z.y + z.h - 1; y++) for (let x = z.x + 1; x < z.x + z.w - 1; x++) {
    if ((x === keep.x && y === keep.y) || store.state.targets.some((t) => t.pos.x === x && t.pos.y === y)) continue;
    store.state.units.push({ ...store.state.units[0]!, id: `g${n++}`, pos: { x, y } });
  }
  const open = released();
  const a = spawnTarget({ title: "A", component: "onboarding" });
  const b = spawnTarget({ title: "B", component: "onboarding" });
  open();
  const [ra, rb] = await Promise.all([a, b]);
  expect(ra.ok).toBe(true);
  expect(rb).toMatchObject({ ok: false, status: 409 });
});

test("brain down: 503, nothing created, no event, logged once", async () => {
  mode = "down";
  const warn = console.warn; const warns: string[] = [];
  console.warn = (m: string) => { warns.push(String(m)); };
  try {
    const before = { targets: store.state.targets.length, events: spawned().length };
    const r1 = await spawnTarget({ title: "Lost", component: "billing" });
    const r2 = await spawnTarget({});
    expect(r1).toMatchObject({ ok: false, status: 503 });
    expect(r2).toMatchObject({ ok: false, status: 503 });
    expect(store.state.targets.length).toBe(before.targets);
    expect(spawned().length).toBe(before.events);
    expect(warns.filter((w) => w.includes("POST /issues"))).toHaveLength(1);
    mode = "500";
    expect(await spawnTarget({ title: "Lost" })).toMatchObject({ ok: false, status: 503 });
    mode = "noTarget";
    expect(await spawnTarget({ title: "Lost" })).toMatchObject({ ok: false, status: 503 });
    expect(store.state.targets.length).toBe(before.targets);
  } finally { console.warn = warn; }
  // the tiles of failed spawns are free again
  mode = "ok";
  expect((await spawnTarget({ title: "Back" })).ok).toBe(true);
});

test("brain non-2xx (pool exhausted): 503 with the brain's error, nothing created", async () => {
  mode = "409";
  const n = store.state.targets.length;
  const r = await spawnTarget({});
  expect(r).toMatchObject({ ok: false, status: 503 });
  expect((r as any).error).toContain("issue pool exhausted");
  expect(store.state.targets.length).toBe(n);
});

test("the brain's target is used unchanged", async () => {
  const r = await spawnTarget({ title: "Echo" });
  const brain = calls[0]!; // the fake brain echoes pos and component from the request
  expect((r as any).target).toEqual({ id: "t110", issue: "LUM-110", title: "Echo", component: brain.body.component, kind: "bug", severity: 2, status: "open", pos: brain.body.pos, customers: ["acme-robotics"] });
});

test("tile choice: farthest from targets, units, buildings and pending spawns", async () => {
  const r = await spawnTarget({ title: "Far", component: "billing" });
  const p = (r as any).target.pos as Pos;
  const others = [...store.state.targets.filter((t) => t.id !== "t110").map((t) => t.pos), ...store.state.units.map((u) => u.pos), ...store.state.buildings];
  const gap = (q: Pos) => Math.min(...others.map((o) => Math.max(Math.abs(o.x - q.x), Math.abs(o.y - q.y))));
  const z = zoneOf("billing");
  for (let y = z.y + 1; y < z.y + z.h - 1; y++) for (let x = z.x + 1; x < z.x + z.w - 1; x++) {
    if (!onBuilding({ x, y }) && !others.some((o) => o.x === x && o.y === y)) expect(gap({ x, y })).toBeLessThanOrEqual(gap(p));
  }
});

test("bad input: 400 and no brain call", async () => {
  for (const body of [[], "x", 5, { component: "nope" }, { kind: "epic" }, { severity: 5 }, { severity: "high" }, { customers: "acme" }, { customers: [1] }, { title: 7 }, { body: {} }]) {
    const r = await spawnTarget(body);
    expect(r).toMatchObject({ ok: false, status: 400 });
  }
  expect(calls).toHaveLength(0);
  expect((await spawnTarget({ severity: "3", title: "String severity" })).ok).toBe(true);
});

test("engine reset during the brain call: no stale push into the new world", async () => {
  const open = released();
  const p = spawnTarget({ title: "Stale", component: "billing" });
  await Bun.sleep(5);
  store.state = fixtureState(); // POST /api/reset replaces the state
  const before = spawned().length;
  open();
  const r = await p;
  expect(r).toMatchObject({ ok: false, status: 409, error: "engine reset during the spawn; no target added" });
  expect(store.state.targets.some((t) => t.id === "t110")).toBe(false);
  expect(spawned().length).toBe(before);
});

test("engine reset during the brain call whose world load already has the target: that target, no duplicate, no event", async () => {
  const open = released();
  const p = spawnTarget({ title: "Registered", component: "auth" });
  await Bun.sleep(5);
  const fresh = fixtureState();
  const pos = calls[0]!.body.pos;
  fresh.targets.push({ id: "t110", issue: "LUM-110", title: "Registered", component: "auth", kind: "bug", severity: 2, status: "open", pos, customers: [] });
  store.state = fresh;
  const before = spawned().length;
  open();
  const r = await p;
  expect(r.ok).toBe(true);
  expect(store.state.targets.filter((t) => t.id === "t110")).toHaveLength(1);
  expect(spawned().length).toBe(before);
});

test("brain id already in the engine: 409, no duplicate", async () => {
  forceId = "t101";
  const r = await spawnTarget({ title: "Dup", component: "search" });
  expect(r).toMatchObject({ ok: false, status: 409 });
  expect(store.state.targets.filter((t) => t.id === "t101")).toHaveLength(1);
});
