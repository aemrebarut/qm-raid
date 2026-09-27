// Loadout (src/loadout.ts) against fake bridges (fetch stub, no network, no live engine): cd services/engine && bun test test/loadout.test.ts
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

// Fake main bridge and Forge: GET /catalog, PATCH /units/:id. Records every call.
type Call = { method: string; url: string; body: any };
let calls: Call[] = [];
let mode: "ok" | "down" | "500" | "400" | "404once" | "echoOnly" = "ok";
let gate: Promise<void> | null = null;
let seen404 = false;
const realFetch = globalThis.fetch;
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const fakeFetch = (async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ method, url: String(url), body });
  if (gate) await gate;
  if (mode === "down") throw new TypeError("fetch failed: connection refused");
  if (mode === "500") return json({ ok: false, error: "boom" }, 500);
  const forge = String(url).startsWith((process.env.FORGE_URL ?? "http://127.0.0.1:4612").replace(/\/$/, ""));
  if (String(url).endsWith("/catalog")) {
    return json({ items: forge
      ? [{ id: "gbrain", name: "GBrain", kind: "plugin", description: "team memory" }]
      : [{ id: "debug", name: "Debug", kind: "skill", description: "bisect" }, { id: "gbrain", name: "GBrain", kind: "plugin", description: "memory" }, { id: "bad", kind: "other" }, { name: "no id", kind: "skill" }] });
  }
  if (method === "PATCH") {
    if (mode === "400") return json({ ok: false, error: "unknown skill nope" }, 400);
    if (mode === "404once" && !seen404) { seen404 = true; return json({ ok: false, error: "unknown unit" }, 404); }
    if (mode === "echoOnly") return json({ ok: true });
    if (forge) return json({ ok: true, loadout: body.loadout ?? { instructions: "", skills: [], plugins: ["gbrain"] }, typeId: "refund-ranger", notes: ["skills are not used by forge units"] });
    return json({ ok: true, loadout: body.loadout, model: body.model ?? "mock", effort: body.effort ?? "medium", applied: "live" });
  }
  return json({ ok: false, error: "not found" }, 404);
}) as unknown as typeof fetch;
beforeAll(() => { globalThis.fetch = fakeFetch; });
afterAll(() => { globalThis.fetch = realFetch; });

const { store, recentEvents } = await import("../src/store.ts");
const { fixtureState } = await import("../src/fixture.ts");
const { BRIDGE_URL, FORGE_URL } = await import("../src/config.ts");
const { getCatalog, patchLoadout, reapplyLoadout } = await import("../src/loadout.ts");

const unit = (i = 0) => store.state.units[i]!;
const updates = (id: string) => recentEvents().filter((e: any) => e.type === "unit.updated" && e.unit?.id === id);

beforeEach(() => {
  globalThis.fetch = fakeFetch;
  store.state = fixtureState();
  calls = []; mode = "ok"; gate = null; seen404 = false;
});

test("catalog: main bridge by default, invalid items dropped", async () => {
  const r = await getCatalog();
  expect(r.ok).toBe(true);
  expect(calls[0]!.url).toBe(`${BRIDGE_URL}/catalog`);
  expect((r as any).items.map((i: any) => i.id)).toEqual(["debug", "gbrain"]);
});

test("catalog: a unit's own bridge (forged class -> the Forge), unknown unit 404", async () => {
  store.state.units.push({ ...unit(), id: "uf", class: "refund-ranger" });
  const r = await getCatalog("uf");
  expect(calls[0]!.url).toBe(`${FORGE_URL}/catalog`);
  expect((r as any).items).toEqual([{ id: "gbrain", name: "GBrain", kind: "plugin", description: "team memory" }]);
  const b = await getCatalog(unit().id);
  expect(calls[1]!.url).toBe(`${BRIDGE_URL}/catalog`);
  expect(b.ok).toBe(true);
  expect(await getCatalog("nope")).toEqual({ ok: false, status: 404, error: "unknown unit nope" });
});

test("catalog: bridge down -> 503", async () => {
  mode = "down";
  const r = await getCatalog();
  expect(r.ok).toBe(false);
  expect((r as any).status).toBe(503);
});

test("patch: merges over the current loadout, sends the full loadout plus model and effort, stores and emits", async () => {
  const u = unit();
  const before = updates(u.id).length;
  const r = await patchLoadout(u.id, { skills: ["debug"], model: "gpt-6-sol", effort: "low" });
  expect(r.ok).toBe(true);
  expect(calls[0]!.method).toBe("PATCH");
  expect(calls[0]!.url).toBe(`${BRIDGE_URL}/units/${u.id}`);
  expect(calls[0]!.body).toEqual({ loadout: { instructions: "", skills: ["debug"], plugins: ["gbrain"] }, model: "gpt-6-sol", effort: "low" });
  expect(u.loadout).toEqual({ instructions: "", skills: ["debug"], plugins: ["gbrain"] });
  expect(u.model).toBe("gpt-6-sol");
  expect(u.effort).toBe("low");
  expect(updates(u.id).length).toBe(before + 1);
  // a second patch keeps the skills and changes only the instructions
  await patchLoadout(u.id, { instructions: "Write the test first." });
  expect(calls[1]!.body).toEqual({ loadout: { instructions: "Write the test first.", skills: ["debug"], plugins: ["gbrain"] } });
  expect(u.loadout).toEqual({ instructions: "Write the test first.", skills: ["debug"], plugins: ["gbrain"] });
});

test("patch: model or effort alone sends no loadout", async () => {
  const u = unit();
  await patchLoadout(u.id, { effort: "high" });
  expect(calls[0]!.body).toEqual({ effort: "high" });
  expect(u.effort).toBe("high");
});

test("patch: forge unit goes to the Forge and passes its notes on", async () => {
  store.state.units.push({ ...unit(), id: "uf", class: "refund-ranger" });
  const r = await patchLoadout("uf", { instructions: "Be brief.", plugins: [] });
  expect(calls[0]!.url).toBe(`${FORGE_URL}/units/uf`);
  expect(r).toMatchObject({ ok: true, notes: ["skills are not used by forge units"] });
  expect(store.state.units.find((x) => x.id === "uf")!.loadout).toEqual({ instructions: "Be brief.", skills: [], plugins: [] });
});

test("patch: bad input -> 400 and no bridge call", async () => {
  const u = unit();
  for (const b of [null, [], {}, { instructions: 5 }, { instructions: "x".repeat(4001) }, { skills: "debug" }, { plugins: [1] }, { model: "" }, { effort: "max" }]) {
    const r = await patchLoadout(u.id, b);
    expect(r.ok).toBe(false);
    expect((r as any).status).toBe(400);
  }
  expect(calls.length).toBe(0);
  expect((await patchLoadout("nope", { effort: "low" }) as any).status).toBe(404);
});

test("patch: bridge refuses (4xx) -> same status and its error, nothing stored", async () => {
  mode = "400";
  const u = unit();
  const r = await patchLoadout(u.id, { skills: ["nope"] });
  expect(r).toEqual({ ok: false, status: 400, error: "unknown skill nope" });
  expect(u.loadout).toEqual({ instructions: "", skills: [], plugins: ["gbrain"] });
});

test("patch: bridge down or 5xx -> 503, nothing stored", async () => {
  const u = unit();
  for (const m of ["down", "500"] as const) {
    mode = m;
    const before = updates(u.id).length;
    const r = await patchLoadout(u.id, { skills: ["debug"] });
    expect((r as any).status).toBe(503);
    expect(u.loadout?.skills).toEqual([]);
    expect(updates(u.id).length).toBe(before);
  }
});

test("patch: bridge 404 (not registered yet) -> ensureSpawned, then one retry", async () => {
  mode = "404once";
  const u = unit();
  let spawned = 0;
  const r = await patchLoadout(u.id, { skills: ["debug"] }, async () => { spawned++; return true; });
  expect(r.ok).toBe(true);
  expect(spawned).toBe(1);
  expect(calls.filter((c) => c.method === "PATCH").length).toBe(2);
});

test("patch: a bridge that answers only {ok} -> the requested values are stored", async () => {
  mode = "echoOnly";
  const u = unit();
  await patchLoadout(u.id, { plugins: [], model: "gpt-6-luna" });
  expect(u.loadout).toEqual({ instructions: "", skills: [], plugins: [] });
  expect(u.model).toBe("gpt-6-luna");
});

test("patch: engine reset during the bridge call -> 409, the new state is untouched", async () => {
  let open!: () => void;
  gate = new Promise((r) => { open = r; });
  const id = unit().id;
  const p = patchLoadout(id, { skills: ["debug"] });
  store.state = fixtureState(); // reset replaces the state while the PATCH is in flight
  open();
  const r = await p;
  expect(r.ok).toBe(false);
  expect((r as any).status).toBe(409);
  expect(store.state.units.find((x) => x.id === id)!.loadout).toEqual({ instructions: "", skills: [], plugins: ["gbrain"] });
});

test("reapplyLoadout: pushes a non-default loadout, skips the default one", async () => {
  const u = unit();
  await reapplyLoadout(u);
  expect(calls.length).toBe(0);
  u.loadout = { instructions: "Be brief.", skills: [], plugins: ["gbrain"] };
  await reapplyLoadout(u);
  expect(calls[0]).toMatchObject({ method: "PATCH", url: `${BRIDGE_URL}/units/${u.id}`, body: { loadout: u.loadout } });
});
