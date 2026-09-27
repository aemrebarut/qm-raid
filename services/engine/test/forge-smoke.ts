// Smoke test for src/forge.ts (E12) against the live Forge: bun test/forge-smoke.ts [--create [--wait-ready]]
// Default is read-only. --create makes one type on the Forge, always with dryRun: true (a Forge in river mode
// would otherwise start real, paid training); only use it on a Forge that honors dryRun. Also re-runs itself with FORGE_URL on a dead port (--down) to check degradation,
// and against an in-process fake Forge (--vanish) to check types that disappear from GET /types.
import type { UnitType } from "../../../contract/types.ts";
import { FORGE_URL } from "../src/config.ts";
import { forgeEval, forgeProxy, forgeType, pollForge, startForge } from "../src/forge.ts";
import { BRIDGE_URL } from "../src/config.ts";
import { store, subscribe } from "../src/store.ts";

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const updates: UnitType[] = [];
subscribe((chunk) => {
  const ev = JSON.parse(chunk.replace(/^data: /, ""));
  if (ev.type === "forge.updated") updates.push(ev.unitType);
});
const builtinIds = () => store.state.unitTypes.filter((t) => t.source === "builtin").map((t) => t.id).sort().join(",");

if (process.argv.includes("--vanish")) {
  // fake Forge on FORGE_URL's port: two ready types, then both vanish; a unit still uses one of them
  let list: any[] = [{ id: "fx-keep", name: "Keep", status: "ready", progress: 1, stage: "", model: "m1" }, { id: "fx-drop", name: "Drop", status: "ready", progress: 1, stage: "", model: "m2" }];
  const evalBody = { typeId: "fx-keep", name: "Keep", metrics: [{ key: "overall", label: "Overall", trained: 0.8, base: 0.5 }] };
  const srv = Bun.serve({ hostname: "127.0.0.1", port: Number(new URL(FORGE_URL).port), fetch: (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/types/fx-keep/eval") return Response.json(evalBody);
    if (p.endsWith("/eval")) return Response.json({ ok: false, error: p.includes("fx-drop") ? "dry run: no eval" : "no such type" }, { status: 404 });
    return Response.json(list);
  } });
  await pollForge();
  check(forgeType("fx-keep")?.status === "ready" && forgeType("fx-drop")?.status === "ready", "fake forge: 2 types merged");
  const mock = new URL(BRIDGE_URL).port === "4615";
  const e1 = await forgeEval("fx-keep"), e2 = await forgeEval("fx-drop"), e3 = await forgeEval("nope");
  check(e1.status === 200 && JSON.stringify(e1.body) === JSON.stringify(evalBody), "eval: the Forge's eval passes through unchanged");
  check(mock
    ? e2.status === 200 && (e2.body as any).mock === true && (e2.body as any).typeId === "fx-drop" && (e2.body as any).metrics?.some((m: any) => m.key === "overall") && !!(e2.body as any).sample
    : e2.status === 404 && (e2.body as any).error === "dry run: no eval", mock ? "eval, mock backend: dry-run type gets the fixed plausible eval" : "eval, QM backend: dry-run 404 passes through unchanged");
  check(e3.status === 404 && (e3.body as any).error === "no such type", "eval: unknown type 404 passes through");
  store.state.units.push({ id: "ufx", name: "Fx", class: "fx-keep", model: "m1", effort: "low", role: "worker", team: null, status: "idle", pos: { x: 0, y: 0 }, orderId: null, qm: { sessionId: null, sessionUrl: null } });
  list = [];
  const n = updates.length;
  await pollForge();
  const last = updates.slice(n);
  check(forgeType("fx-keep")?.status === "failed" && forgeType("fx-keep")?.stage === "gone from the Forge", "vanished type still used by a unit: kept as failed, gone from the Forge");
  check(forgeType("fx-drop") === null && last.some((u) => u.id === "fx-drop" && u.status === "failed" && u.stage === "removed from the Forge"), "vanished unused type: dropped after one forge.updated (removed from the Forge)");
  const m = updates.length;
  await pollForge();
  check(updates.length === m && forgeType("fx-drop") === null, "next poll: no repeat updates");
  store.state.units = store.state.units.filter((u) => u.id !== "ufx");
  await pollForge();
  check(forgeType("fx-keep") === null && updates.slice(m).some((u) => u.id === "fx-keep" && u.stage === "removed from the Forge"), "type dropped once its last unit is gone");
  srv.stop(true);
  process.exit(failures ? 1 : 0);
}

if (process.argv.includes("--down")) {
  await pollForge();
  check(builtinIds() === "knight,ranger,scout" && store.state.unitTypes.every((t) => t.source === "builtin"), `forge down (${FORGE_URL}): builtins kept, no throw`);
  const r = await forgeProxy({ name: "X", description: "y", dryRun: true });
  check(r.ok === false && /unreachable/.test((r as any).error), "forge down: forgeProxy -> {ok:false, error}");
  check((await forgeEval("x")).status === 503, "forge down: eval of an unknown type -> 503");
  process.exit(failures ? 1 : 0);
}

const live = await fetch(`${FORGE_URL}/types`).then((r) => r.json()).catch(() => null);
check(Array.isArray(live), `forge up at ${FORGE_URL}`);
const stop = startForge();
startForge(); // idempotent
await Bun.sleep(2500);
const forged = store.state.unitTypes.filter((t) => t.source === "forge");
check(builtinIds() === "knight,ranger,scout", "builtins kept first");
check(forged.length === (live ?? []).length && forged.every((t) => t.id && t.name && typeof t.progress === "number" && "model" in t), `merged ${forged.length} forge types as UnitType`);
check(updates.length >= forged.length, `forge.updated emitted for each new type (${updates.length})`);

const n0 = updates.length;
await Bun.sleep(2200);
const readyUpdates = updates.slice(n0).filter((u) => forged.find((f) => f.id === u.id && f.status === "ready"));
check(readyUpdates.length === 0, "no forge.updated for unchanged ready types on the next poll");

check((await forgeProxy({ name: "" })).ok === false, "forgeProxy without name/description -> {ok:false}");
check(forgeType("knight") === null && forgeType("nope") === null && (forged[0] ? forgeType(forged[0].id)?.id === forged[0].id : true), "forgeType(id) lookup (forge only)");
if (process.argv.includes("--create")) {
const r = await forgeProxy({ name: "Smoke Scout", description: "engine forge.ts smoke test type; safe to ignore", dryRun: true });
check(r.ok === true && typeof (r as any).typeId === "string", `forgeProxy -> {ok:true, typeId: ${(r as any).typeId}}`);
const typeId = (r as any).typeId as string;
const t1 = Date.now();
while (Date.now() - t1 < 5000 && !updates.some((u) => u.id === typeId)) await Bun.sleep(100);
check(updates.some((u) => u.id === typeId && u.source === "forge"), "forge.updated for the new type within 5 s");
check(forgeType(typeId)?.id === typeId && forgeType("knight") === null && forgeType("nope") === null, "forgeType(id) lookup (forge only)");

if (process.argv.includes("--wait-ready")) {
  const t2 = Date.now();
  while (Date.now() - t2 < 120000 && forgeType(typeId)?.status !== "ready" && forgeType(typeId)?.status !== "failed") await Bun.sleep(500);
  const seen = updates.filter((u) => u.id === typeId).map((u) => `${u.status} ${u.progress.toFixed(2)}`);
  console.log(`     progress: ${seen.join(" | ")}`);
  check(forgeType(typeId)?.status === "ready" && !!forgeType(typeId)?.model, `new type ready with a model after ${((Date.now() - t2) / 1000).toFixed(0)} s`);
}
}
stop();

const down = Bun.spawnSync(["bun", import.meta.path, "--down"], { env: { ...process.env, FORGE_URL: "http://127.0.0.1:4699" }, stdout: "inherit", stderr: "inherit" });
check(down.exitCode === 0, "forge-down run passed");
const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
const fakePort = probe.port; probe.stop(true);
const vanish = Bun.spawnSync(["bun", import.meta.path, "--vanish"], { env: { ...process.env, FORGE_URL: `http://127.0.0.1:${fakePort}` }, stdout: "inherit", stderr: "inherit" });
check(vanish.exitCode === 0, "vanished-types and eval run passed (mock backend)");
const probe2 = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
const fakePort2 = probe2.port; probe2.stop(true);
const vanishQm = Bun.spawnSync(["bun", import.meta.path, "--vanish"], { env: { ...process.env, FORGE_URL: `http://127.0.0.1:${fakePort2}`, BRIDGE_URL: "http://127.0.0.1:4614" }, stdout: "inherit", stderr: "inherit" });
check(vanishQm.exitCode === 0, "vanished-types and eval run passed (QM backend, no bridge calls)");
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
