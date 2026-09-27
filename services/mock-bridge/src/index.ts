// mock-bridge: fake agents behind the Bridge API (docs/CONTRACT.md). No dependencies.
import type { BridgeEvent, SendRequest, SpawnRequest, SpawnResponse } from "../../../contract/types.ts";
import { buildScript, isOrderSend } from "./script.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4615);
const SPEED = Math.max(0.1, Number(process.env.MOCK_SPEED ?? 1)); // >1 plays scripts faster (tests)
const ERROR_RATE = Math.min(1, Math.max(0, Number(process.env.MOCK_FAIL ?? 0) || 0)); // 0.1 = 10% of orders fail
const BASE = `http://${HOST}:${PORT}`;

interface MockUnit extends SpawnRequest {
  sessionId: string;
  createdAt: number;
  orderId: string | null;               // order whose script is playing
  timers: { order: Timer[]; chat: Timer[] };
  log: BridgeEvent[];                   // last events, shown at GET /units/:id (the sessionUrl)
}
const units = new Map<string, MockUnit>();

// ---- SSE fan-out ----
const enc = new TextEncoder();
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();

function emit(ev: BridgeEvent) {
  const u = units.get(ev.unitId);
  if (u) { u.log.push(ev); if (u.log.length > 200) u.log.shift(); }
  const chunk = enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
  for (const c of clients) {
    try { c.enqueue(chunk); } catch { clients.delete(c); }
  }
}

function sse(req: Request, server: ReturnType<typeof Bun.serve>): Response {
  server.timeout(req, 0); // SSE must outlive Bun's idle timeout
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let ping: Timer | undefined;
  const drop = () => { clients.delete(ctrl); if (ping) clearInterval(ping); };
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      clients.add(c);
      c.enqueue(enc.encode(": connected\n\n"));
      ping = setInterval(() => { try { c.enqueue(enc.encode(": ping\n\n")); } catch { drop(); } }, 15000);
    },
    cancel: drop,
  });
  req.signal.addEventListener("abort", drop);
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
  });
}

// ---- units ----
function ensureUnit(id: string, spec?: Partial<SpawnRequest>): MockUnit {
  let u = units.get(id);
  if (!u) {
    u = {
      id, name: spec?.name ?? id, model: spec?.model ?? "mock", effort: spec?.effort ?? "medium",
      role: spec?.role ?? "worker", team: spec?.team ?? null,
      sessionId: `mock-${id}`, createdAt: Date.now(), orderId: null,
      timers: { order: [], chat: [] }, log: [],
    };
    units.set(id, u);
  } else if (spec) {
    for (const k of ["name", "model", "effort", "role", "team"] as const) if (spec[k] !== undefined) (u as any)[k] = spec[k];
  }
  return u;
}

function stop(u: MockUnit, which: "order" | "chat" | "all") {
  if (which !== "chat") { u.timers.order.forEach(clearTimeout); u.timers.order = []; u.orderId = null; }
  if (which !== "order") { u.timers.chat.forEach(clearTimeout); u.timers.chat = []; }
}

function play(u: MockUnit, req: SendRequest) {
  const order = isOrderSend(req);
  // a new order replaces the running one (no terminal event for the old order); a chat runs alongside
  stop(u, order ? "order" : "chat");
  const slot = order ? u.timers.order : u.timers.chat;
  if (order) u.orderId = req.orderId ?? null;
  const steps = buildScript(u.id, u.name, req, { errorRate: ERROR_RATE });
  for (const s of steps) {
    const t = setTimeout(() => {
      if (units.get(u.id) !== u) return; // deleted meanwhile
      emit(s.event);
      if (order && (s.event.type === "reply" || s.event.type === "error")) { u.orderId = null; u.timers.order = []; }
    }, Math.round(s.at / SPEED));
    slot.push(t);
  }
}

function view(u: MockUnit, withLog = false) {
  const { timers, log, ...rest } = u;
  return { ...rest, busy: timers.order.length > 0, ...(withLog ? { log } : {}) };
}

// ---- http ----
const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);
async function body<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 60,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const m = req.method;
    try {
      if (m === "GET" && url.pathname === "/health") return json({ ok: true, service: "mock-bridge", units: units.size, clients: clients.size });
      if (m === "GET" && url.pathname === "/events") return sse(req, srv);

      if (parts[0] === "units") {
        const id = parts[1];
        if (!id) {
          if (m === "GET") return json([...units.values()].map((u) => view(u)));
          if (m === "POST") {
            const b = await body<SpawnRequest>(req);
            if (!b || typeof b.id !== "string" || !b.id) return fail("id required");
            const u = ensureUnit(b.id, b);
            const res: SpawnResponse = { sessionId: u.sessionId, sessionUrl: null };
            console.log(`spawn ${u.id} (${u.name})`);
            return json(res);
          }
        } else if (parts.length === 2) {
          if (m === "GET") { const u = units.get(id); return u ? json(view(u, true)) : fail("unknown unit", 404); }
          if (m === "PATCH") {
            const u = units.get(id);
            if (!u) return fail("unknown unit", 404);
            const b = await body<{ team?: number | null }>(req);
            if (!b) return fail("json body required");
            if (b.team !== undefined) u.team = b.team;
            return json({ ok: true });
          }
          if (m === "DELETE") {
            const u = units.get(id);
            if (u) { stop(u, "all"); units.delete(id); console.log(`delete ${id}`); }
            return json({ ok: true });
          }
        } else if (parts.length === 3 && parts[2] === "send" && m === "POST") {
          const b = await body<SendRequest>(req);
          if (!b || typeof b.text !== "string" || !b.text.trim()) return fail("text required");
          if (!units.has(id)) console.log(`send to unknown unit ${id}: auto-spawning`);
          const u = ensureUnit(id);
          play(u, b);
          console.log(`send ${id}${b.orderId ? ` order ${b.orderId}` : " chat"}: ${b.text.slice(0, 60).replace(/\n/g, " ")}`);
          return json({ ok: true });
        }
      }
      return fail("not found", 404);
    } catch (e) {
      console.error(e);
      return fail(String(e), 500);
    }
  },
});

console.log(`mock-bridge on ${BASE} (speed x${SPEED}, error rate ${ERROR_RATE})`);
export { server };
