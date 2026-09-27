// Smoke test against a running engine (and bridge): bun test/smoke.ts
// ENGINE_URL overrides the default http://127.0.0.1:4610. Exits 1 on the first failure.
import type { EngineEvent, State } from "../../../contract/types.ts";

const BASE = (process.env.ENGINE_URL ?? "http://127.0.0.1:4610").replace(/\/$/, "");
let failed = false;
function check(ok: unknown, what: string): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) { failed = true; process.exitCode = 1; }
}

async function post(path: string, body: string): Promise<{ status: number; data: any }> {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
  return { status: r.status, data: await r.json().catch(() => null) };
}

// Collects SSE events from /api/events in the background.
function openEvents(): { events: EngineEvent[]; close: () => void } {
  const events: EngineEvent[] = [];
  const ac = new AbortController();
  void (async () => {
    try {
      const r = await fetch(`${BASE}/api/events`, { signal: ac.signal });
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of block.split("\n")) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch {}
  })();
  return { events, close: () => ac.abort() };
}

async function waitFor<T>(fn: () => T | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await Bun.sleep(100);
  }
  return undefined;
}

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
check(health?.ok === true && health?.service === "engine", "GET /health");
if (!health) process.exit(1);

const state: State = await fetch(`${BASE}/api/state`).then((r) => r.json());
console.log(`     state: ${state.components.length} components, ${state.units.length} units, ${state.targets.length} targets, backend ${state.backend}`);
check(state.components.length >= 1 && state.units.length >= 1 && state.targets.length >= 1, "GET /api/state has components, units and targets");
check(Array.isArray(state.unitTypes) && state.memory && state.stats && Array.isArray(state.orders), "state has unitTypes, memory, stats, orders");

const sse = openEvents();
const first = await waitFor(() => sse.events[0], 3000);
check(first?.type === "state.snapshot" && typeof first.ts === "number" && typeof first.seq === "number", "SSE sends state.snapshot first (seq, epoch ms ts)");

const bad = await post("/api/orders", "{not json");
check(bad.status === 400 && bad.data?.ok === false, "malformed JSON -> 400 {ok:false}");
const unknown = await post("/api/orders", JSON.stringify({ unitIds: ["u1"], targetId: "nope" }));
check(unknown.status === 400 && unknown.data?.ok === false, "unknown target -> 400 {ok:false}");
const noUnits = await post("/api/orders", JSON.stringify({ targetId: state.targets[0]!.id }));
check(noUnits.status === 400 && noUnits.data?.ok === false, "missing unitIds/teamId -> 400 {ok:false}");

const unit = state.units.find((u) => u.status === "idle");
const target = state.targets.find((t) => t.status === "open");
if (!unit || !target) {
  check(false, "an idle unit and an open target exist (POST /api/reset to restore)");
  process.exit(1);
}
const res = await post("/api/orders", JSON.stringify({ unitIds: [unit.id], targetId: target.id }));
const order = res.data?.orders?.[0];
check(res.data?.ok === true && order?.status === "active" && order?.unitId === unit.id, `POST /api/orders ${unit.id} -> ${target.id} is active`);

const moved = await waitFor(() => sse.events.find((e) => e.type === "unit.moved" && e.unitId === unit.id), 3000);
check(moved, "unit.moved arrives within 3 s");
const working = await waitFor(() => sse.events.find((e) => e.type === "unit.status" && e.unitId === unit.id && e.status === "working"), 20000);
check(working, "unit reaches the target and starts working");
const done = await waitFor(() => sse.events.find((e) => e.type === "order.updated" && e.order.id === order?.id && e.order.status !== "active"), 40000);
check(done?.type === "order.updated" && done.order.status === "done" && !!done.order.reply, `order ${order?.id} done with a reply`);
const activity = sse.events.filter((e) => e.type === "unit.activity" && e.unitId === unit.id).length;
check(activity > 0, `unit.activity events seen (${activity})`);
const seqs = sse.events.map((e) => e.seq);
check(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!), "seq increases");

sse.close();
console.log(failed ? "SMOKE FAILED" : "SMOKE OK");
process.exit(failed ? 1 : 0);
