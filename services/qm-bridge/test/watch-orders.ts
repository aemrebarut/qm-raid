// Read-only order watcher for demo runs: follows the bridge /events?observe=1 stream and prints one line per finished order
// (unit, order, first event and terminal times from the first event seen, gbrain calls, errors, missing recall/remember).
// Run: bun test/watch-orders.ts [unitPrefix]   (default prefix "u"; BRIDGE_URL default http://127.0.0.1:4614)
const BRIDGE = process.env.BRIDGE_URL ?? "http://127.0.0.1:4614";
const prefix = process.argv[2] ?? "u";
type Ev = { type: string; unitId?: string; orderId?: string; kind?: string; text?: string; tool?: string };
const orders = new Map<string, { unitId: string; start: number; first?: number; tools: string[]; errors: string[] }>();
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

const res = await fetch(`${BRIDGE}/events?observe=1`); // observer: never takes the engine's backlog
const reader = res.body!.getReader();
const dec = new TextDecoder();
let buf = "";
console.log(`[watch] ${clock(Date.now())} following ${BRIDGE}/events for units ${prefix}*`);
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  let i: number;
  while ((i = buf.indexOf("\n\n")) >= 0) {
    const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
    buf = buf.slice(i + 2);
    if (!data) continue;
    const ev = JSON.parse(data.slice(6)) as Ev;
    if (!ev.orderId || !ev.unitId?.startsWith(prefix)) continue;
    const now = Date.now();
    let o = orders.get(ev.orderId);
    if (!o) orders.set(ev.orderId, (o = { unitId: ev.unitId, start: now, tools: [], errors: [] }));
    if (ev.type === "activity") {
      o.first ??= now;
      if (ev.kind === "tool" && ev.tool) o.tools.push(ev.tool);
      if (ev.kind === "error") o.errors.push(String(ev.text ?? "").slice(0, 120));
    }
    if (ev.type === "reply" || ev.type === "error") {
      if (ev.type === "error") o.errors.push(String(ev.text ?? "").slice(0, 120));
      const gb = o.tools.filter((t) => t.startsWith("gbrain."));
      const missing = ["gbrain.recall", "gbrain.remember"].filter((t) => !gb.includes(t));
      const rel = (t?: number) => (t ? `+${((t - o!.start) / 1000).toFixed(1)}s` : "-");
      console.log(
        `[watch] ${clock(now)} ${o.unitId} ${ev.orderId} ${ev.type} first=${rel(o.first)} terminal=${rel(now)} ` +
          `gbrain=[${gb.join(",")}]${missing.length ? ` MISSING ${missing.join(",")}` : ""}${o.errors.length ? ` ERRORS ${o.errors.join(" | ")}` : ""}`,
      );
      orders.delete(ev.orderId);
    }
  }
}
