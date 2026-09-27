// Loadout (src/loadout.ts) against fake bridges (fetch stub, no network, no live engine): cd services/engine && bun test test/loadout.test.ts
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";

// Fake main bridge and Forge: GET /catalog, PATCH /units/:id. Records every call.
type Call = { method: string; url: string; body: any };
let calls: Call[] = [];
let mode: "ok" | "down" | "500" | "400" | "registry" | "echoOnly" = "ok";
let known = new Set<string>(); // mode "registry": units the fake bridge knows (POST /units adds, PATCH on others is 404)
let gate: Promise<void> | null = null;
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
  if (method === "POST" && String(url).endsWith("/units")) { known.add(body.id); return json({ sessionId: `s-${body.id}`, sessionUrl: null }); }
  if (method === "PATCH") {
    if (mode === "400") return json({ ok: false, error: "unknown skill nope" }, 400);
    if (mode === "registry" && !known.has(String(url).split("/units/")[1]!)) return json({ ok: false, error: "unknown unit" }, 404);
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
  calls = []; mode = "ok"; gate = null; known = new Set();
});

test("catalog: main bridge by default, invalid items dropped", async () => {
  const r = await getCatalog();
  expect(r.ok).toBe(true);
  expect(calls[0]!.url).toBe(`${BRIDGE_URL}/catalog`);
  expect((r as any).items.map((i: any) => i.id)).toEqual(["debug", "gbrain"]);
  expect((r as any).items[1].description).toBe("The Library: always on. memory");
});

test("catalog: GBrain is always listed and marked locked, even if the bridge leaves it out", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => json({ items: [{ id: "debug", name: "Debug", kind: "skill", description: "bisect" }] })) as unknown as typeof fetch;
  const r = await getCatalog();
  globalThis.fetch = orig;
  expect((r as any).items.at(-1)).toMatchObject({ id: "gbrain", name: "GBrain", kind: "plugin" });
  expect((r as any).items.at(-1).description.startsWith("The Library: always on.")).toBe(true);
});

test("catalog: a bridge that already sends the hint (qm-bridge: no period) is not prefixed twice", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => json({ items: [{ id: "gbrain", name: "GBrain", kind: "plugin", description: "The Library: always on" }] })) as unknown as typeof fetch;
  const a = await getCatalog();
  globalThis.fetch = (async () => json({ items: [{ id: "gbrain", name: "GBrain", kind: "plugin", description: "The Library: always on. Team memory" }] })) as unknown as typeof fetch;
  const b = await getCatalog();
  globalThis.fetch = (async () => json({ items: [{ id: "gbrain", name: "GBrain", kind: "plugin", description: "" }] })) as unknown as typeof fetch;
  const c = await getCatalog();
  globalThis.fetch = orig;
  expect((a as any).items[0].description).toBe("The Library: always on");
  expect((b as any).items[0].description).toBe("The Library: always on. Team memory");
  expect((c as any).items[0].description).toBe("The Library: always on.");
});

test("patch: GBrain is locked on (a PATCH without it keeps it; a bridge answer without it is corrected)", async () => {
  const u = unit();
  await patchLoadout(u.id, { plugins: ["github"] });
  expect(calls[0]!.body.loadout.plugins).toEqual(["gbrain", "github"]);
  expect(u.loadout?.plugins).toEqual(["gbrain", "github"]);
  await patchLoadout(u.id, { plugins: [] });
  expect(calls[1]!.body.loadout.plugins).toEqual(["gbrain"]);
  expect(u.loadout?.plugins).toEqual(["gbrain"]);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => json({ ok: true, loadout: { instructions: "", skills: [], plugins: ["github"] } })) as unknown as typeof fetch;
  await patchLoadout(u.id, { plugins: ["github"] });
  globalThis.fetch = orig;
  expect(u.loadout?.plugins).toEqual(["gbrain", "github"]);
});

test("catalog: a unit's own bridge (forged class -> the Forge), unknown unit 404", async () => {
  store.state.units.push({ ...unit(), id: "uf", class: "refund-ranger" });
  const r = await getCatalog("uf");
  expect(calls[0]!.url).toBe(`${FORGE_URL}/catalog`);
  expect((r as any).items).toEqual([{ id: "gbrain", name: "GBrain", kind: "plugin", description: "The Library: always on. team memory" }]);
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
  expect(calls[0]!.body.loadout.plugins).toEqual(["gbrain"]); // GBrain stays on for forge units too
  expect(store.state.units.find((x) => x.id === "uf")!.loadout).toEqual({ instructions: "Be brief.", skills: [], plugins: ["gbrain"] });
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

// A forced re-register as game.ts must provide it: a fresh POST /units even if the engine thinks the unit is registered.
const forceRegister = async (u: any) => (await realFetchLike(`${BRIDGE_URL}/units`, u)) === 200;
const realFetchLike = async (url: string, u: any) => (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: u.id, name: u.name, model: u.model, effort: u.effort, role: u.role, team: u.team }) })).status;

test("patch: the bridge forgot the unit (restart) -> forced re-register, PATCH retried with the full loadout", async () => {
  mode = "registry"; // the bridge knows nobody: it restarted after the engine registered the unit
  const u = unit();
  u.loadout = { instructions: "Be brief.", skills: [], plugins: ["gbrain"] };
  const r = await patchLoadout(u.id, { skills: ["debug"] }, forceRegister);
  expect(r.ok).toBe(true);
  expect(calls.map((c) => `${c.method} ${c.url.replace(BRIDGE_URL, "")}`)).toEqual([`PATCH /units/${u.id}`, "POST /units", `PATCH /units/${u.id}`]);
  expect(calls[2]!.body).toEqual({ loadout: { instructions: "Be brief.", skills: ["debug"], plugins: ["gbrain"] } }); // saved loadout restored too
  expect(u.loadout?.skills).toEqual(["debug"]);
});

test("patch: model/effort-only change on a forgotten unit -> the retry restores the full saved loadout (rev race probe)", async () => {
  mode = "registry";
  const u = unit();
  u.loadout = { instructions: "Review every change.", skills: ["debug"], plugins: ["gbrain", "github"] };
  const r = await patchLoadout(u.id, { effort: "high" }, forceRegister);
  expect(r.ok).toBe(true);
  expect(calls.map((c) => `${c.method} ${c.url.replace(BRIDGE_URL, "")}`)).toEqual([`PATCH /units/${u.id}`, "POST /units", `PATCH /units/${u.id}`]);
  expect(calls[0]!.body).toEqual({ effort: "high" }); // a registered unit gets only the change
  expect(calls[2]!.body).toEqual({ effort: "high", loadout: { instructions: "Review every change.", skills: ["debug"], plugins: ["gbrain", "github"] } });
  expect(u.loadout).toEqual({ instructions: "Review every change.", skills: ["debug"], plugins: ["gbrain", "github"] });
  expect(u.effort).toBe("high");
});

test("patch: a re-register callback that does not re-POST (plain ensureSpawned on a registered unit) -> 502, nothing stored", async () => {
  mode = "registry";
  const u = unit();
  const r = await patchLoadout(u.id, { skills: ["debug"] }, async () => true);
  expect(r).toMatchObject({ ok: false, status: 502 });
  expect(calls.filter((c) => c.method === "PATCH").length).toBe(2);
  expect(calls.filter((c) => c.method === "POST").length).toBe(0);
  expect(u.loadout?.skills).toEqual([]);
});

test("patch: bridge 404 without a re-register callback -> 502 after one PATCH", async () => {
  mode = "registry";
  const r = await patchLoadout(unit().id, { effort: "low" });
  expect(r).toMatchObject({ ok: false, status: 502 });
  expect(calls.length).toBe(1);
});

test("patch: a bridge that answers only {ok} -> the requested values are stored", async () => {
  mode = "echoOnly";
  const u = unit();
  await patchLoadout(u.id, { plugins: ["github"], model: "gpt-6-luna" });
  expect(u.loadout).toEqual({ instructions: "", skills: [], plugins: ["gbrain", "github"] });
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
