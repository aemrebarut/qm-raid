// HTTP routes of the engine (served by index.ts; imported by tests without a server).
import { BRAIN_URL, CORS_ORIGINS } from "./config.ts";
import { listenerCount, recentEvents, store } from "./store.ts";
import { sseResponse } from "./sse.ts";
import { forgeProxy } from "./forge.ts";
import { adjustOrder, assignTeam, cancelOrder, createOrders, goOrder, messageUnit, patchTeam, patchUnit, resetWorld, retireUnit, spawnUnit } from "./game.ts";

// Only listed browser origins get CORS headers; any other page can neither read nor change engine state.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !CORS_ORIGINS.includes(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "content-type" };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function reply(r: { ok: boolean; status?: number; [k: string]: unknown }): Response {
  const { status, ...body } = r;
  return json(body, r.ok ? 200 : (status ?? 400));
}

// undefined = invalid JSON; null = a body that is not declared as JSON (blocks form and text/plain CSRF).
async function body(req: Request): Promise<any> {
  const text = await req.text();
  if (!text.trim()) return {};
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return null;
  try { return JSON.parse(text); } catch { return undefined; }
}

// Library proxies: pass the brain's answer through unchanged.
async function brainProxy(path: string, search: string): Promise<Response> {
  try {
    const r = await fetch(`${BRAIN_URL}${path}${search}`, { signal: AbortSignal.timeout(8000) });
    return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
  } catch {
    return json({ ok: false, error: `brain unavailable at ${BRAIN_URL}` }, 502);
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const m = req.method;
  if (m === "OPTIONS") return new Response(null, { status: 204 });
  // Browsers send Origin on every cross-site POST/PATCH/DELETE, even bodyless no-cors ones; curl and services send none.
  const origin = req.headers.get("origin");
  if (m !== "GET" && origin && !CORS_ORIGINS.includes(origin)) return json({ ok: false, error: "origin not allowed" }, 403);

  if (m === "GET") {
    if (p === "/health") return json({ ok: true, service: "engine" });
    if (p === "/api/state") return json(store.state);
    if (p === "/api/events") return sseResponse(req, {});
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
  if (b === null) return json({ ok: false, error: "content-type must be application/json" }, 415);
  if (b === undefined) return json({ ok: false, error: "invalid JSON body" }, 400);
  let mm: RegExpMatchArray | null;

  if (m === "POST") {
    if (p === "/api/orders") return reply(createOrders(b));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/cancel$/))) return reply(cancelOrder(decodeURIComponent(mm[1]!)));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/go$/))) return reply(goOrder(decodeURIComponent(mm[1]!)));
    if ((mm = p.match(/^\/api\/orders\/([^/]+)\/adjust$/))) return reply(adjustOrder(decodeURIComponent(mm[1]!), b));
    if (p === "/api/units") return reply(spawnUnit(b));
    if (p === "/api/forge/types") { const r = await forgeProxy(b); return json(r, r.ok ? 200 : 400); }
    if ((mm = p.match(/^\/api\/units\/([^/]+)\/message$/))) return reply(await messageUnit(decodeURIComponent(mm[1]!), b));
    if (p === "/api/teams") return reply(assignTeam(b));
    if (p === "/api/reset") return reply(await resetWorld());
  } else {
    if ((mm = p.match(/^\/api\/units\/([^/]+)$/))) return reply(patchUnit(decodeURIComponent(mm[1]!), b));
    if ((mm = p.match(/^\/api\/teams\/(\d+)$/))) return reply(patchTeam(Number(mm[1]), b));
  }
  return json({ ok: false, error: "not found" }, 404);
}

export async function handle(req: Request): Promise<Response> {
  let res: Response;
  try {
    res = await route(req);
  } catch (err) {
    console.error("[engine] request failed:", err);
    res = json({ ok: false, error: "internal error" }, 500);
  }
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}
