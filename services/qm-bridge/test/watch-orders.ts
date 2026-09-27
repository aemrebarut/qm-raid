// Read-only order watcher for demo runs: follows the bridge /events?observe=1 stream and prints one line per finished order
// (unit, order, queue depth, first event and terminal times from the send (bridge .state/timing.jsonl), gbrain calls,
// errors, missing recall/remember, the slug it remembered and the learning slugs its reply cites).
// Run: bun test/watch-orders.ts [unitPrefix]   (default prefix "u"; BRIDGE_URL default http://127.0.0.1:4614)
import { readFileSync } from "node:fs";
import { join } from "node:path";
const BRIDGE = process.env.BRIDGE_URL ?? "http://127.0.0.1:4614";
const TIMING = join(import.meta.dir, "..", ".state", "timing.jsonl");
const prefix = process.argv[2] ?? "u";
type Ev = { type: string; unitId?: string; orderId?: string; kind?: string; text?: string; tool?: string; args?: Record<string, unknown> };
const orders = new Map<string, { unitId: string; start: number; first?: number; tools: string[]; errors: string[]; remembered: string[] }>();
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
type Row = { orderId: string; depth: number; t_send: number; t_queued: number | null; t_first_event: number | null; t_terminal: number };
function timing(orderId: string): string {
  try {
    const rows = readFileSync(TIMING, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Row);
    const r = rows.reverse().find((x) => x.orderId === orderId);
    if (!r) return "timing=-";
    const rel = (t: number | null) => (t ? `+${((t - r.t_send) / 1000).toFixed(1)}s` : "-");
    return `depth=${r.depth} queued=${rel(r.t_queued)} first=${rel(r.t_first_event)} terminal=${rel(r.t_terminal)}`;
  } catch {
    return "timing=-";
  }
}

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
    if (!o) orders.set(ev.orderId, (o = { unitId: ev.unitId, start: now, tools: [], errors: [], remembered: [] }));
    if (ev.type === "activity") {
      o.first ??= now;
      if (ev.kind === "tool" && ev.tool) o.tools.push(ev.tool);
      if (ev.tool === "gbrain.remember" && typeof ev.args?.slug === "string") o.remembered.push(ev.args.slug);
      if (ev.kind === "error") o.errors.push(String(ev.text ?? "").slice(0, 120));
    }
    if (ev.type === "reply" || ev.type === "error") {
      if (ev.type === "error") o.errors.push(String(ev.text ?? "").slice(0, 120));
      const gb = o.tools.filter((t) => t.startsWith("gbrain."));
      const missing = ["gbrain.recall", "gbrain.remember"].filter((t) => !gb.includes(t));
      const cites = [...new Set(String(ev.text ?? "").match(/learnings\/[a-z0-9._-]*[a-z0-9]/gi) ?? [])];
      const line =
        `${o.unitId} ${ev.orderId} ${ev.type} ` +
        `gbrain=[${gb.join(",")}]${missing.length ? ` MISSING ${missing.join(",")}` : ""}${o.errors.length ? ` ERRORS ${o.errors.join(" | ")}` : ""} ` +
        `remembered=[${o.remembered.join(",")}] cites=[${cites.join(",")}]`;
      const orderId = ev.orderId;
      setTimeout(() => console.log(`[watch] ${clock(now)} ${line} ${timing(orderId)}`), 500); // timing row lands just after the terminal
      orders.delete(ev.orderId);
    }
  }
}
