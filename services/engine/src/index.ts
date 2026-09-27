// Engine service: game state, orders, teams and the SSE event stream on 127.0.0.1:4610.
import { BRAIN_URL, BRIDGE_URL, HOST, PORT } from "./config.ts";
import { listenerCount, recentEvents, snapshotChunk, store, subscribe } from "./store.ts";
import { adjustOrder, assignTeam, cancelOrder, createOrders, goOrder, messageUnit, patchTeam, patchUnit, resetWorld, retireUnit, spawnUnit, startGame } from "./game.ts";

process.on("unhandledRejection", (err) => console.error("[engine] unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[engine] uncaught exception:", err));

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "content-type" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
}

function reply(r: { ok: boolean; status?: number; [k: string]: unknown }): Response {
  const { status, ...body } = r;
  return json(body, r.ok ? 200 : (status ?? 400));
}

async function body(req: Request): Promise<any> {
  const text = await req.text();
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { return undefined; }
}

function events(req: Request): Response {
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (chunk: string) => ctrl.enqueue(enc.encode(chunk));
      send(snapshotChunk());
      unsub = subscribe(send);
      ping = setInterval(() => { try { send(": ping\n\n"); } catch { unsub(); } }, 15000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(ping); try { ctrl.close(); } catch {} });
    },
    cancel() { unsub(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...CORS } });
}

// Library proxies: pass the brain's answer through unchanged.
async function brainProxy(path: string, search: string): Promise<Response> {
  try {
    const r = await fetch(`${BRAIN_URL}${path}${search}`, { signal: AbortSignal.timeout(8000) });
    return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json", ...CORS } });
  } catch {
    return json({ ok: false, error: `brain unavailable at ${BRAIN_URL}` }, 502);
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (m === "GET") {
    if (p === "/health") return json({ ok: true, service: "engine" });
    if (p === "/api/state") return json(store.state);
    if (p === "/api/events") return events(req);
    if (p === "/api/debug/events") return json({ clients: listenerCount(), events: recentEvents() });
    if (p === "/api/brain/graph") return brainProxy("/graph", "");
    if (p === "/api/brain/stats") return brainProxy("/stats", "");
    if (p === "/api/brain/search") return brainProxy("/search", url.search);
    if (p === "/api/brain/page") return brainProxy("/page", url.search);
    return json({ ok: false, error: "not found" }, 404);
  }

  if (m === "DELETE") {
    const mm = p.match(/^\/api\/units\/([^/]+)$/);
    return mm ? reply(retireUnit(decodeURIComponent(mm[1]!))) : json({ ok: false, error: "not found" }, 404);
  }
  if (m !== "POST" && m !== "PATCH") return json({ ok: false, error: "method not allowed" }, 405);
  const b = await body(req);
  if (b === undefined) return json({ ok: false, error: "invalid JSON body" }, 400);
  let mm: RegExpMatchArray | null;

  if (m === "POST") {
    if (p === "/api/orders") return reply(createOrders(b));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/cancel$/))) return reply(cancelOrder(decodeURIComponent(mm[1]!)));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/go$/))) return reply(goOrder(decodeURIComponent(mm[1]!)));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/adjust$/))) return reply(adjustOrder(decodeURIComponent(mm[1]!), b));
    if (p === "/api/units") return reply(spawnUnit(b));
    if ((mm = p.match(/^\/api\/units\/([^/]+)\/message$/))) return reply(await messageUnit(decodeURIComponent(mm[1]!), b));
    if (p === "/api/teams") return reply(assignTeam(b));
    if (p === "/api/reset") return reply(await resetWorld());
  } else {
    if ((mm = p.match(/^\/api\/units\/([^/]+)$/))) return reply(patchUnit(decodeURIComponent(mm[1]!), b));
    if ((mm = p.match(/^\/api\/teams\/(\d+)$/))) return reply(patchTeam(Number(mm[1]), b));
  }
  return json({ ok: false, error: "not found" }, 404);
}

await startGame();

Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0, // SSE streams stay open; Bun's default 10 s idle timeout would cut them
  async fetch(req) {
    try {
      return await route(req);
    } catch (err) {
      console.error("[engine] request failed:", err);
      return json({ ok: false, error: "internal error" }, 500);
    }
  },
});

console.log(`[engine] listening on http://${HOST}:${PORT} (bridge ${BRIDGE_URL}, brain ${BRAIN_URL})`);
