// Smoke test for src/forge.ts (E12) against the live Forge: bun test/forge-smoke.ts [--wait-ready]
// Creates one dry-run type on the Forge. Also re-runs itself with FORGE_URL on a dead port (--down) to check degradation.
import type { UnitType } from "../../../contract/types.ts";
import { FORGE_URL } from "../src/config.ts";
import { forgeProxy, forgeType, pollForge, startForge } from "../src/forge.ts";
import { store, subscribe } from "../src/store.ts";

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const updates: UnitType[] = [];
subscribe((chunk) => {
  const ev = JSON.parse(chunk.replace(/^data: /, ""));
  if (ev.type === "forge.updated") updates.push(ev.unitType);
});
const builtinIds = () => store.state.unitTypes.filter((t) => t.source === "builtin").map((t) => t.id).sort().join(",");

if (process.argv.includes("--down")) {
  await pollForge();
  check(builtinIds() === "knight,ranger,scout" && store.state.unitTypes.every((t) => t.source === "builtin"), `forge down (${FORGE_URL}): builtins kept, no throw`);
  const r = await forgeProxy({ name: "X", description: "y" });
  check(r.ok === false && /unreachable/.test((r as any).error), "forge down: forgeProxy -> {ok:false, error}");
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
const r = await forgeProxy({ name: "Smoke Scout", description: "engine forge.ts smoke test type; safe to ignore" });
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
stop();

const down = Bun.spawnSync(["bun", import.meta.path, "--down"], { env: { ...process.env, FORGE_URL: "http://127.0.0.1:4699" }, stdout: "inherit", stderr: "inherit" });
check(down.exitCode === 0, "forge-down run passed");
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
