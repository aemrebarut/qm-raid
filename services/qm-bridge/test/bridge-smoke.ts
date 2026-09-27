// Bridge API end to end: spawn a unit, send one order, wait for its terminal event on /events; then PATCH a loadout,
// check the "Loadout changed: ..." bridge activity (plan A sends no QM turn for it), send a second order and check in
// the QM transcript that its text restates the standing orders and carries the no-edit line; delete.
// Run: bun test/bridge-smoke.ts (env BRIDGE_URL, default http://127.0.0.1:4614; QM_PORTAL_URL, default
// http://localhost:8129; bridge and QM must be up)
const BRIDGE = (process.env.BRIDGE_URL ?? "http://127.0.0.1:4614").replace(/\/$/, "");
const PORTAL = (process.env.QM_PORTAL_URL ?? "http://localhost:8129").replace(/\/$/, "");
const run = Date.now().toString(36);
const unitId = `u-smoke-${run}`;
const orderId = `o-smoke-${run}`;
const order2 = `o-smoke-${run}-2`;
const standing = `Smoke standing order ${run}: answer in lower case.`;
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const post = async (path: string, body: unknown, method = "POST") => {
  const r = await fetch(`${BRIDGE}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json() as Promise<any>;
};

// Observer stream: never takes events the engine would get from the bridge backlog.
const events = await fetch(`${BRIDGE}/events?observe=1`);
if (!events.ok || !events.body) throw new Error(`GET /events -> ${events.status}`);
const reader = events.body.getReader();
const dec = new TextDecoder();
let buf = "";
const seen: any[] = [];

async function waitTerminal(id: string): Promise<any> {
  for (;;) {
    const hit = seen.find((e) => (e.type === "reply" || e.type === "error") && e.orderId === id);
    if (hit) return hit;
    const { value, done } = await reader.read();
    if (done) return null;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.unitId !== unitId) continue;
      seen.push(ev);
      console.log(`${ms()} ${ev.type}${ev.kind ? `/${ev.kind}` : ""}${ev.tool ? ` ${ev.tool}` : ""} order=${ev.orderId ?? "-"} ${String(ev.text ?? "").slice(0, 120)}`);
    }
  }
}

const deadline = setTimeout(async () => {
  console.error(`${ms()} timeout waiting for terminal event`);
  await post(`/units/${unitId}`, {}, "DELETE").catch(() => {});
  process.exit(1);
}, 180_000);

let ok = false;
try {
  const spawned = await post("/units", { id: unitId, name: "Smoke", model: "gpt-5.6-luna", effort: "low", role: "worker", team: 1 });
  console.log(`${ms()} POST /units ->`, spawned);
  console.log(`${ms()} POST /send ->`, await post(`/units/${unitId}/send`, { text: "Reply with the single word: pong", orderId, targetId: "t-smoke", componentId: "billing" }));
  const t1 = await waitTerminal(orderId);

  const loadout = { instructions: standing, skills: ["raid-board"], plugins: ["gbrain"] };
  const patched = await post(`/units/${unitId}`, { loadout, effort: "low" }, "PATCH");
  console.log(`${ms()} PATCH loadout ->`, patched);
  await post(`/units/${unitId}/send`, { text: "Reply with the single word: pong", orderId: order2, targetId: "t-smoke", componentId: "billing" });
  const t2 = await waitTerminal(order2);

  // QM transcript: marker turn, then the order restating the standing orders.
  const sid = patched.sessionUrl?.split("/s/")[1] ?? spawned.sessionId;
  const tx = await fetch(`${PORTAL}/api/sessions/${sid}?tailTurns=10`).then((r) => r.json() as Promise<any>);
  const userTexts: string[] = (tx.entries ?? []).filter((e: any) => e.type === "user").map((e: any) => String(e.payload?.text ?? ""));
  const noMarkerTurn = !userTexts.some((t) => t.includes("Loadout changed"));
  const changed = seen.some((e) => e.type === "activity" && !e.orderId && String(e.text).startsWith("Loadout changed: "));
  const restated = userTexts.some(
    (t) => t.includes(`order ${order2}`) && t.includes(`Standing orders: ${standing}`) && t.includes("Loadout: skills raid-board | plugins gbrain") && t.includes("do not change any QM settings"),
  );
  console.log(`${ms()} PATCH echo ok=${patched.ok && patched.loadout?.instructions === standing} change activity=${changed} no QM marker turn=${noMarkerTurn} order restates loadout + no-edit line=${restated}`);
  ok = t1?.type === "reply" && t2?.type === "reply" && patched.ok && changed && noMarkerTurn && restated;
} finally {
  clearTimeout(deadline);
  reader.cancel().catch(() => {});
  console.log(`${ms()} DELETE ->`, await post(`/units/${unitId}`, {}, "DELETE"));
}
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
