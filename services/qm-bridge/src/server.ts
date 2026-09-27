// qm-bridge: Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 backed by real QM agents, one QM session per unit.
import type { BridgeEvent, SendRequest, SpawnRequest } from "../../../contract/types.ts";
import {
  PORTAL_URL,
  archiveSession,
  findSessionId,
  getRun,
  principal,
  runFinished,
  runtimeConfig,
  sessionUrl,
  startTurn,
  threadRefFor,
  type RunState,
} from "./qm.ts";
import { normalizeTool, toolArgs, toolText } from "./tools.ts";

const PORT = Number(process.env.PORT ?? 4614);
const HOST = "127.0.0.1";
// A fresh thread namespace per bridge start, so a reset demo does not continue old conversations.
const BOOT = Date.now().toString(36);

interface Send extends SendRequest {
  intro?: boolean;
}
interface Unit extends SpawnRequest {
  threadRef: string;
  sessionId: string | null;
  queue: Send[];
  active: { runId: string; send: Send } | null;
}

const units = new Map<string, Unit>();
let codexModels: string[] = [];
const CODEX_EFFORTS = ["auto", "low", "medium", "high", "xhigh"];

// ---------- SSE fan-out ----------
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();

function emit(ev: BridgeEvent): void {
  const line = enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
  for (const c of clients) {
    try {
      c.enqueue(line);
    } catch {
      clients.delete(c);
    }
  }
}
setInterval(() => {
  const ping = enc.encode(": ping\n\n");
  for (const c of clients) {
    try {
      c.enqueue(ping);
    } catch {
      clients.delete(c);
    }
  }
}, 15_000);

function activity(u: Unit, send: Send, kind: "message" | "tool" | "thinking" | "error", text: string, extra: { tool?: string; args?: unknown } = {}): void {
  emit({ type: "activity", unitId: u.id, ...(send.orderId ? { orderId: send.orderId } : {}), kind, text, ...extra });
}

// ---------- turns ----------
function header(u: Unit, s: Send): string {
  if (s.intro) return s.text;
  const tags = [
    `unit ${u.id}`,
    s.orderId && `order ${s.orderId}`,
    s.targetId && `target ${s.targetId}`,
    s.componentId && `component ${s.componentId}`,
    u.team != null && `team ${u.team}`,
  ].filter(Boolean);
  return `[${tags.join(" | ")}]\n${s.text}`;
}

function turnOptions(u: Unit): { model?: string; thinkingLevel?: string } {
  return {
    ...(codexModels.includes(u.model) ? { model: u.model } : {}),
    ...(CODEX_EFFORTS.includes(u.effort) ? { thinkingLevel: u.effort } : {}),
  };
}

function enqueue(u: Unit, s: Send): void {
  u.queue.push(s);
  pump(u);
}

function pump(u: Unit): void {
  if (u.active || u.queue.length === 0 || !units.has(u.id)) return;
  const s = u.queue.shift()!;
  u.active = { runId: "", send: s };
  startTurn(u.threadRef, header(u, s), turnOptions(u))
    .then(({ runId }) => {
      if (!u.active || u.active.send !== s) return;
      u.active.runId = runId;
      void follow(u, s, runId);
    })
    .catch((err) => finish(u, s, { ok: false, text: `QM unavailable: ${String(err?.message ?? err)}` }));
}

// Exactly one terminal event per send.
function finish(u: Unit, s: Send, outcome: { ok: boolean; text: string }): void {
  if (!u.active || u.active.send !== s) return;
  u.active = null;
  if (s.intro) {
    // The intro is not an order: its text was streamed as chat; never a terminal event.
    if (!outcome.ok) activity(u, s, "error", outcome.text);
  } else if (outcome.ok) {
    emit({ type: "reply", unitId: u.id, ...(s.orderId ? { orderId: s.orderId } : {}), text: outcome.text });
  } else {
    emit({ type: "error", unitId: u.id, ...(s.orderId ? { orderId: s.orderId } : {}), text: outcome.text });
  }
  pump(u);
}

function outcomeOf(run: RunState): { ok: boolean; text: string } {
  const r = run.result;
  if (r?.status === "ok") return { ok: true, text: r.reply ?? run.partial ?? "" };
  const why = r?.reason ?? r?.message ?? r?.refusalKind ?? r?.status ?? run.status;
  return { ok: false, text: `QM run ${run.status}: ${why}` };
}

/** Follow a run's SSE stream, translate to Bridge activity, then decide the terminal event from GET /api/runs/:id. */
async function follow(u: Unit, s: Send, runId: string): Promise<void> {
  let text = ""; // reply text seen so far (deltas or run.partial)
  let flushed = 0; // chars already emitted as message activity
  let lastFlush = 0; // set when text first arrives
  const flush = (force = false): void => {
    const pending = text.slice(flushed).trim();
    if (!pending) return;
    const now = Date.now();
    if (!lastFlush) lastFlush = now;
    // Emit whole sentences, or a longer run of text every 1.5 s, never single words.
    if (!force && !/[.!?:]\s*$/.test(pending) && (now - lastFlush < 1500 || pending.length < 40)) return;
    activity(u, s, "message", pending);
    flushed = text.length;
    lastFlush = now;
  };

  const seenTools = new Set<string>();
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!u.active || u.active.send !== s) return;
    let finished = false;
    try {
      const res = await fetch(`${PORTAL_URL}/api/runs/${encodeURIComponent(runId)}/events`, {
        headers: { accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          let ev: any;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          if (ev.type === "TOOL_CALL_START") {
            if (seenTools.has(ev.toolCallId)) continue;
            seenTools.add(ev.toolCallId);
            const tool = normalizeTool(ev.toolCallName, ev.args ?? {});
            const args = toolArgs(ev.args ?? {});
            activity(u, s, "tool", toolText(tool, args), { tool, args });
          } else if (ev.type === "TOOL_CALL_RESULT") {
            if (ev.isError) activity(u, s, "error", `tool failed: ${String(ev.content ?? "").slice(0, 200)}`);
          } else if (ev.type === "CUSTOM" && ev.name === "delta") {
            const { offset, delta } = ev.value ?? {};
            if (typeof delta === "string" && typeof offset === "number" && offset <= text.length) {
              text = text.slice(0, offset) + delta;
              flush();
            }
          } else if (ev.type === "CUSTOM" && ev.name === "run") {
            const run = ev.value as RunState;
            // Snapshots carry the text so far; take it when it is ahead of our deltas (late subscribe, reconnect).
            if (typeof run?.partial === "string" && run.partial.length > text.length) {
              text = run.partial;
              flush();
            }
            if (run && runFinished(run)) finished = true;
          } else if (ev.type === "RUN_FINISHED") {
            finished = true; // sent for failed runs too; outcome comes from GET /api/runs/:id
          }
        }
        if (finished) break;
      }
      reader.cancel().catch(() => {});
    } catch (err) {
      console.warn(`[qm-bridge] ${u.id} run ${runId} stream: ${String((err as Error)?.message ?? err)}`);
    }
    // Stream ended (finished or dropped): check the run itself.
    try {
      const run = await getRun(runId);
      if (runFinished(run)) {
        const out = outcomeOf(run);
        if (out.ok && out.text.length > text.length) text = out.text;
        flush(true);
        if (!u.sessionId && run.result?.sessionId) u.sessionId = run.result.sessionId;
        finish(u, s, out);
        return;
      }
    } catch (err) {
      console.warn(`[qm-bridge] ${u.id} run ${runId} read: ${String((err as Error)?.message ?? err)}`);
    }
    await Bun.sleep(1000 * (attempt + 1));
  }
  finish(u, s, { ok: false, text: `lost track of QM run ${runId}` });
}

// ---------- HTTP ----------
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    return {};
  }
}

function introText(u: Unit): string {
  return (
    `You are ${u.name}, a ${u.role} agent${u.team != null ? ` on team ${u.team}` : ""} on the QM Raid board. ` +
    `You will get orders to work product issues; each order starts with a [order | target | component] header. ` +
    `Use the gbrain tools, when you have them, to recall before you work and to remember what you learn. ` +
    `Reply to this message with one short line saying you are ready.`
  );
}

async function createUnit(b: Partial<SpawnRequest> & { id: string }): Promise<Unit> {
  const u: Unit = {
    id: b.id,
    name: b.name ?? b.id,
    model: b.model ?? "",
    effort: b.effort ?? "",
    role: b.role ?? "worker",
    team: b.team ?? null,
    threadRef: await threadRefFor(`${b.id}-${BOOT}`),
    sessionId: null,
    queue: [],
    active: null,
  };
  units.set(u.id, u);
  return u;
}

async function spawn(req: Request): Promise<Response> {
  const b = await body<SpawnRequest>(req);
  if (!b.id) return json({ ok: false, error: "id required" }, 400);
  const existing = units.get(b.id);
  if (existing) return json({ sessionId: existing.sessionId, sessionUrl: existing.sessionId ? sessionUrl(existing.sessionId) : null });
  let u: Unit;
  try {
    u = await createUnit({ ...b, id: b.id });
  } catch (err) {
    return json({ ok: false, error: `QM unavailable: ${String((err as Error)?.message ?? err)}` }, 502);
  }
  enqueue(u, { text: introText(u), intro: true });
  // The session exists as soon as QM accepts the turn; look it up briefly so "Open in QM" works at once.
  for (let i = 0; i < 8 && !u.sessionId; i++) {
    await Bun.sleep(250);
    u.sessionId = await findSessionId(u.threadRef).catch(() => null);
  }
  return json({ sessionId: u.sessionId, sessionUrl: u.sessionId ? sessionUrl(u.sessionId) : null });
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const m = req.method;

    if (m === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "qm-bridge", qm: PORTAL_URL, units: units.size });
    }
    if (m === "GET" && url.pathname === "/events") {
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c;
          clients.add(c);
          c.enqueue(enc.encode(": open\n\n"));
        },
        cancel() {
          clients.delete(ctl);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
      });
    }
    if (m === "POST" && url.pathname === "/units") return spawn(req);

    if (parts[0] === "units" && parts[1]) {
      const id = decodeURIComponent(parts[1]);
      let u = units.get(id);
      if (!u && m === "DELETE") return json({ ok: true });
      if (!u) {
        // Unknown unit (for example after a bridge restart): adopt it with a fresh session instead of failing the order.
        try {
          u = await createUnit({ id });
          console.log(`[qm-bridge] adopted unknown unit ${id}`);
        } catch (err) {
          return json({ ok: false, error: `QM unavailable: ${String((err as Error)?.message ?? err)}` }, 502);
        }
      }
      if (m === "POST" && parts[2] === "send") {
        const b = await body<Send>(req);
        if (!b.text || typeof b.text !== "string") return json({ ok: false, error: "text required" }, 400);
        enqueue(u, { text: b.text, orderId: b.orderId, targetId: b.targetId, componentId: b.componentId });
        return json({ ok: true, queued: u.queue.length });
      }
      if (m === "PATCH" && !parts[2]) {
        const b = await body<{ team: number | null }>(req);
        if ("team" in b) u.team = b.team ?? null;
        return json({ ok: true });
      }
      if (m === "DELETE" && !parts[2]) {
        units.delete(u.id);
        u.queue = [];
        u.active = null;
        if (u.sessionId) archiveSession(u.sessionId).catch(() => {});
        return json({ ok: true });
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  },
});

console.log(`[qm-bridge] listening on http://${HOST}:${server.port} (QM portal ${PORTAL_URL})`);
principal()
  .then(async (p) => {
    const cfg = await runtimeConfig();
    codexModels = cfg.modelsByHarness?.codex ?? [];
    console.log(`[qm-bridge] QM principal ${p}; harnesses ${cfg.approvedHarnesses?.join(",")}; codex models ${codexModels.join(",")}`);
  })
  .catch((err) => console.warn(`[qm-bridge] QM not reachable yet: ${String(err?.message ?? err)}`));
