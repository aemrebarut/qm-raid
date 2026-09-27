// Bridge API end to end: spawn a unit, send one order, wait for its terminal event on /events, delete.
// Run: bun test/bridge-smoke.ts (env BRIDGE_URL, default http://127.0.0.1:4614; bridge and QM must be up)
const BRIDGE = (process.env.BRIDGE_URL ?? "http://127.0.0.1:4614").replace(/\/$/, "");
const unitId = `u-smoke-${Date.now().toString(36)}`;
const orderId = `o-smoke-${Date.now().toString(36)}`;
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const post = async (path: string, body: unknown, method = "POST") => {
  const r = await fetch(`${BRIDGE}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json() as Promise<any>;
};

const events = await fetch(`${BRIDGE}/events`);
if (!events.ok || !events.body) throw new Error(`GET /events -> ${events.status}`);
const reader = events.body.getReader();

const spawned = await post("/units", { id: unitId, name: "Smoke", model: "gpt-5.6-luna", effort: "low", role: "worker", team: 1 });
console.log(`${ms()} POST /units ->`, spawned);
const sent = await post(`/units/${unitId}/send`, { text: "Reply with the single word: pong", orderId, targetId: "t-smoke", componentId: "billing" });
console.log(`${ms()} POST /send ->`, sent);

let terminal: any = null;
const dec = new TextDecoder();
let buf = "";
const deadline = setTimeout(() => {
  console.error(`${ms()} timeout waiting for terminal event`);
  process.exit(1);
}, 90_000);
while (!terminal) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i: number;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
    buf = buf.slice(i + 2);
    if (!line) continue;
    const ev = JSON.parse(line.slice(5));
    if (ev.unitId !== unitId) continue;
    console.log(`${ms()} ${ev.type}${ev.kind ? `/${ev.kind}` : ""}${ev.tool ? ` ${ev.tool}` : ""} order=${ev.orderId ?? "-"} ${String(ev.text ?? "").slice(0, 120)}`);
    if ((ev.type === "reply" || ev.type === "error") && ev.orderId === orderId) terminal = ev;
  }
}
clearTimeout(deadline);
reader.cancel().catch(() => {});
console.log(`${ms()} DELETE ->`, await post(`/units/${unitId}`, {}, "DELETE"));
process.exit(terminal?.type === "reply" ? 0 : 1);
