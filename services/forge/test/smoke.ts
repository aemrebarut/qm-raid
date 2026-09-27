// Smoke test: forge must be running (bun run dev). Creates a type and checks it progresses.
const BASE = process.env.FORGE_URL ?? "http://127.0.0.1:4612";
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };

const h = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
if (!h?.ok || h.service !== "forge") fail(`health: ${JSON.stringify(h)}`);
console.log("health ok, mode", h.mode);

const bad = await fetch(`${BASE}/types`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
if (bad.status !== 400) fail(`empty POST /types should be 400, got ${bad.status}`);

const created = await fetch(`${BASE}/types`, {
  method: "POST", headers: { "content-type": "application/json" },
  // dryRun: never start real River training from a smoke test
  body: JSON.stringify({ name: "Smoke Ranger", description: "triages billing refund bugs and replies in the house tone", dryRun: true }),
}).then((r) => r.json());
if (!created.ok || !created.typeId) fail(`POST /types: ${JSON.stringify(created)}`);
console.log("created", created.typeId);

const keys = ["id", "name", "description", "status", "progress", "stage", "examples", "evalScore", "model"];
let last: any = null;
for (let i = 0; i < 20; i++) {
  await Bun.sleep(500);
  const list = await fetch(`${BASE}/types`).then((r) => r.json());
  if (!Array.isArray(list)) fail("GET /types is not an array");
  last = list.find((t: any) => t.id === created.typeId);
  if (!last) fail("created type missing from GET /types");
  for (const k of keys) if (!(k in last)) fail(`type missing key ${k}`);
  if (last.status === "failed") fail(`type failed: ${last.stage}`);
  if (last.progress > 0.05) break;
}
if (!(last.progress > 0)) fail(`no progress: ${JSON.stringify(last)}`);
console.log("progress", last.status, last.progress.toFixed(2), last.stage);
console.log("PASS");
