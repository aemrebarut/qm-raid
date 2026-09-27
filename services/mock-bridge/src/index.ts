// mock-bridge: fake agents behind the Bridge API (docs/CONTRACT.md). No dependencies.
import type { BridgeEvent, SendRequest, SpawnRequest, SpawnResponse } from "../../../contract/types.ts";
import { buildScript, isOrderSend, learningFrom, type Learning } from "./script.ts";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4615);
const BASE = `http://${HOST}:${PORT}`;

// Env vars are the defaults; POST /debug/config changes them at runtime (not part of the Bridge API).
const clamp = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const config = {
  speed: clamp(process.env.MOCK_SPEED ?? 1, 0.1, 100, 1),      // >1 plays scripts faster (tests)
  fail: clamp(process.env.MOCK_FAIL ?? 0, 0, 1, 0),            // 0.1 = 10% of orders end in a terminal error
  noGbrain: truthy(process.env.MOCK_NO_GBRAIN),                // no gbrain tool calls (engine fallback)
  mcpNames: clamp(process.env.MOCK_MCP_NAMES ?? 0.25, 0, 1, 0.25), // share of runs with mcp__gbrain__* tool names
  script: process.env.MOCK_SCRIPT === "demo" ? "demo" : "default",  // demo: wave 1 learns a rule, wave 2 recalls it
  review: ["approve", "changes"].includes(process.env.MOCK_REVIEW ?? "") ? process.env.MOCK_REVIEW as "approve" | "changes" : "loop" as "loop" | "approve" | "changes", // workflow reviewer verdicts
};

// Demo memory: learnings the mock agents remembered, oldest first. Cleared by POST /debug/reset or when the last unit is deleted.
let learnings: Learning[] = [];

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
  const demo = config.script === "demo";
  const steps = buildScript(u.id, u.name, req, { errorRate: config.fail, noGbrain: config.noGbrain, mcpRate: config.mcpNames, demo, learnings, review: config.review });
  const speed = config.speed;
  for (const s of steps) {
    const t = setTimeout(() => {
      if (units.get(u.id) !== u) return; // deleted meanwhile
      emit(s.event);
      const l = demo ? learningFrom(s.event, u.name) : null; // only demo sends feed the demo memory
      if (l) { learnings.push(l); if (learnings.length > 100) learnings.shift(); }
      if (order && (s.event.type === "reply" || s.event.type === "error")) { u.orderId = null; u.timers.order = []; }
    }, Math.round(s.at / speed));
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
      if (m === "POST" && url.pathname === "/debug/reset") { const n = learnings.length; learnings = []; console.log(`demo memory cleared (${n})`); return json({ ok: true, cleared: n }); }
      if (m === "GET" && url.pathname === "/debug/learnings") return json(learnings);
      if (url.pathname === "/debug/config") {
        if (m === "GET") return json({ ok: true, config, learnings: learnings.length });
        if (m === "POST") {
          const b = await body<{ speed?: number; fail?: number; noGbrain?: boolean; mcpNames?: number; script?: string; review?: string }>(req);
          if (!b || typeof b !== "object") return fail("json body required");
          if (b.speed !== undefined) config.speed = clamp(b.speed, 0.1, 100, config.speed);
          if (b.fail !== undefined) config.fail = clamp(b.fail, 0, 1, config.fail);
          if (b.noGbrain !== undefined) config.noGbrain = truthy(b.noGbrain);
          if (b.mcpNames !== undefined) config.mcpNames = clamp(b.mcpNames, 0, 1, config.mcpNames);
          if (b.script !== undefined) config.script = b.script === "demo" ? "demo" : "default";
          if (b.review !== undefined) config.review = b.review === "approve" || b.review === "changes" ? b.review : "loop";
          console.log(`config ${JSON.stringify(config)}`);
          return json({ ok: true, config });
        }
      }

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
            if (units.size === 0 && learnings.length) { learnings = []; console.log("all units deleted: demo memory cleared"); }
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

console.log(`mock-bridge on ${BASE} ${JSON.stringify(config)}`);
export { server };
