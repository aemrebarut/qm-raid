// qm-bridge: Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 backed by real QM agents, one QM conversation per unit.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BridgeEvent, SendRequest, SpawnRequest } from "../../../contract/types.ts";
import {
  PORTAL_URL,
  findSessionId,
  getRun,
  orgSpend,
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
// Unit map survives bridge restarts so in-flight units keep their QM sessions (gitignored).
const STATE_FILE = join(import.meta.dir, "..", ".state", "units.json");
// One stable QM conversation per unit: threadRef web:<principal>:raid-<ns>-<unitId>, across respawns, resets and restarts.
// Change QM_THREAD_NS to start every unit in a fresh conversation.
const THREAD_NS = process.env.QM_THREAD_NS ?? "r1";
const ROUND_MARKER = "New round: the board was reset. Recall from GBrain before each order. Reply with one short line.";

interface Send extends SendRequest {
  intro?: boolean;
  key?: string; // idempotency key, persisted, so retries and post-crash re-sends never start a second run
}
interface Unit extends SpawnRequest {
  threadRef: string;
  sessionId: string | null;
  queue: Send[];
  active: { runId: string; send: Send } | null;
}

const units = new Map<string, Unit>();
const retired = new Set<string>(); // deleted unit ids; their next spawn opens a new round in the same conversation
const lastWork = new Map<string, number>(); // unitId -> last time it had a run (usage attribution)
const alive = (u: Unit): boolean => units.get(u.id) === u;

function saveUnits(): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ units: [...units.values()], retired: [...retired] }, null, 1));
  } catch (err) {
    console.warn(`[qm-bridge] cannot save unit map: ${String((err as Error)?.message ?? err)}`);
  }
}

function loadUnits(): void {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { units?: Unit[]; retired?: string[] } | Unit[];
    const rows = Array.isArray(saved) ? saved : (saved.units ?? []);
    for (const id of Array.isArray(saved) ? [] : (saved.retired ?? [])) retired.add(id);
    for (const r of rows) {
      if (!r?.id || !r.threadRef) continue;
      const busy = r.active || r.queue?.length;
      // Idle units on an old per-spawn thread are dropped: the engine's next send gets 404 and re-spawns on the stable thread.
      if (!busy && !r.threadRef.endsWith(`:raid-${THREAD_NS}-${r.id}`)) continue;
      units.set(r.id, { ...r, queue: r.queue ?? [], active: r.active ?? null });
    }
    if (units.size) console.log(`[qm-bridge] restored ${units.size} unit(s) from ${STATE_FILE}`);
    for (const u of units.values()) {
      const a = u.active;
      if (a?.runId) void follow(u, a.send, a.runId); // resume the in-flight run: its terminal event still arrives
      else if (a) {
        u.active = null; // crashed before QM accepted the turn: send it again
        u.queue.unshift(a.send);
      }
      pump(u);
    }
  } catch {
    // no saved state yet
  }
}
let codexModels: string[] = [];
const CODEX_EFFORTS = ["auto", "low", "medium", "high", "xhigh"];

// ---------- SSE fan-out ----------
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const enc = new TextEncoder();

// Events emitted while no client is connected (engine restarting, bridge just restarted) are replayed to the next client.
const backlog: Uint8Array[] = [];

function emit(ev: BridgeEvent): void {
  const line = enc.encode(`data: ${JSON.stringify(ev)}\n\n`);
  if (clients.size === 0) {
    backlog.push(line);
    if (backlog.length > 500) backlog.shift();
    return;
  }
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
  if (!alive(u)) return; // deleted or replaced units stay silent
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

function turnOptions(u: Unit, s: Send): { model?: string; thinkingLevel?: string; idempotencyKey?: string } {
  return {
    ...(s.key ? { idempotencyKey: s.key } : {}),
    ...(codexModels.includes(u.model) ? { model: u.model } : {}),
    ...(CODEX_EFFORTS.includes(u.effort) ? { thinkingLevel: u.effort } : {}),
  };
}

function enqueue(u: Unit, s: Send): void {
  s.key ??= `raid-${crypto.randomUUID()}`; // on disk before any dispatch, so a re-send after a crash is deduped by QM
  u.queue.push(s);
  pump(u);
  saveUnits();
}

/** Start a send as the unit's active run; rejects if QM does not accept the turn. */
async function begin(u: Unit, s: Send): Promise<void> {
  s.key ??= `raid-${crypto.randomUUID()}`;
  u.active = { runId: "", send: s };
  if (alive(u)) saveUnits(); // persist key + active marker before QM sees the turn (crash-safe, no double execution)
  const { runId } = await startTurn(u.threadRef, header(u, s), turnOptions(u, s));
  if (!u.active || u.active.send !== s) return;
  u.active.runId = runId;
  lastWork.set(u.id, Date.now());
  if (alive(u)) saveUnits();
  void follow(u, s, runId);
}

function pump(u: Unit): void {
  if (u.active || u.queue.length === 0 || !alive(u)) return;
  const s = u.queue.shift()!;
  begin(u, s).catch((err) => finish(u, s, { ok: false, text: `QM unavailable: ${String(err?.message ?? err)}` }));
}

// Exactly one terminal event per send.
function finish(u: Unit, s: Send, outcome: { ok: boolean; text: string }): void {
  if (!u.active || u.active.send !== s) return;
  u.active = null;
  lastWork.set(u.id, Date.now());
  if (!alive(u)) return;
  saveUnits();
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
  // Keep following through stream drops and QM restarts (runs are durable in QM's Postgres) for up to 10 minutes.
  const deadline = Date.now() + 10 * 60_000;
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    if (!alive(u) || !u.active || u.active.send !== s) return;
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
        if (!alive(u) || u.active?.send !== s) break; // deleted, replaced or finished elsewhere: drop the stream
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
    if (!alive(u) || u.active?.send !== s) return;
    // Stream ended (finished or dropped): check the run itself.
    try {
      const run = await getRun(runId);
      if (runFinished(run)) {
        const out = outcomeOf(run);
        if (out.ok && out.text.length > text.length) text = out.text;
        flush(true);
        if (!u.sessionId && run.result?.sessionId) {
          u.sessionId = run.result.sessionId;
          if (alive(u)) saveUnits();
        }
        finish(u, s, out);
        return;
      }
    } catch (err) {
      console.warn(`[qm-bridge] ${u.id} run ${runId} read: ${String((err as Error)?.message ?? err)}`);
    }
    await Bun.sleep(Math.min(1000 * (attempt + 1), 5000));
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
    `You will get orders to work product issues; each order starts with a [unit | order | target | component | team] header. ` +
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
    threadRef: await threadRefFor(`${THREAD_NS}-${b.id}`),
    sessionId: null,
    queue: [],
    active: null,
  };
  return u;
}

function retire(u: Unit): void {
  units.delete(u.id);
  retired.add(u.id);
  u.queue = [];
  u.active = null;
  saveUnits(); // the QM conversation stays: the unit's next spawn continues it with a round marker
}

async function spawn(req: Request): Promise<Response> {
  const b = await body<SpawnRequest>(req);
  if (!b.id) return json({ ok: false, error: "id required" }, 400);
  const existing = units.get(b.id);
  if (existing) {
    // Same unit again (engine restart, re-spawn without delete): keep the conversation, refresh settings, no extra turn.
    existing.name = b.name ?? existing.name;
    existing.model = b.model ?? existing.model;
    existing.effort = b.effort ?? existing.effort;
    existing.role = b.role ?? existing.role;
    if ("team" in b) existing.team = b.team ?? null;
    existing.sessionId ??= await findSessionId(existing.threadRef).catch(() => null);
    saveUnits();
    return json({ sessionId: existing.sessionId, sessionUrl: existing.sessionId ? sessionUrl(existing.sessionId) : null });
  }
  let u: Unit | null = null;
  try {
    u = await createUnit({ ...b, id: b.id });
    u.sessionId = await findSessionId(u.threadRef); // throws when QM is down -> 502
    units.set(u.id, u);
    if (!u.sessionId) {
      await begin(u, { text: introText(u), intro: true }); // new conversation: intro turn creates it
    } else if (retired.has(u.id)) {
      await begin(u, { text: ROUND_MARKER, intro: true }); // back after a reset: mark the new round
    }
    retired.delete(u.id);
    saveUnits();
  } catch (err) {
    if (u && alive(u)) units.delete(u.id);
    saveUnits();
    return json({ ok: false, error: `QM unavailable: ${String((err as Error)?.message ?? err)}` }, 502);
  }
  // A new conversation exists as soon as QM accepts the turn; look it up briefly so "Open in QM" works at once.
  for (let i = 0; i < 8 && !u.sessionId; i++) {
    await Bun.sleep(250);
    u.sessionId = await findSessionId(u.threadRef).catch(() => null);
  }
  if (u.sessionId) saveUnits();
  return json({ sessionId: u.sessionId, sessionUrl: u.sessionId ? sessionUrl(u.sessionId) : null });
}

// ---------- usage ----------
// QM exposes only org-wide spend, so each 5 s tick splits the token delta across units that worked recently.
// QM records spend some seconds after a run ends, hence the wide window.
const USAGE_WINDOW_MS = 90_000;
let spendBase: { tokens: number; costUsd: number } | null = null;
setInterval(async () => {
  const now = Date.now();
  for (const u of units.values()) if (u.active) lastWork.set(u.id, now);
  const working = [...lastWork].filter(([, t]) => now - t < USAGE_WINDOW_MS).map(([id]) => id);
  if (spendBase && working.length === 0) return;
  try {
    const cur = await orgSpend();
    const base = spendBase;
    spendBase = cur;
    if (!base || working.length === 0) return;
    const tokens = cur.tokens - base.tokens;
    const usd = cur.costUsd - base.costUsd;
    if (tokens <= 0 && usd <= 0) return;
    for (const unitId of working) {
      emit({ type: "usage", unitId, tokens: Math.round(tokens / working.length), usd: usd / working.length });
    }
  } catch {
    // spend is optional; ignore while QM is unreachable
  }
}, 5_000);

loadUnits();

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
          const replay = backlog.splice(0);
          for (const line of replay) c.enqueue(line);
          if (replay.length) console.log(`[qm-bridge] replayed ${replay.length} buffered event(s) to a new /events client`);
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
      const u = units.get(id);
      if (!u && m === "DELETE") return json({ ok: true });
      // Unknown unit: 404, so the engine re-POSTs its full SpawnRequest (model, effort, team) and retries.
      // Restarts do not lose units: the map is restored from .state/units.json.
      if (!u) return json({ ok: false, error: "unknown unit" }, 404);
      if (m === "POST" && parts[2] === "send") {
        const b = await body<Send>(req);
        if (!b.text || typeof b.text !== "string") return json({ ok: false, error: "text required" }, 400);
        enqueue(u, { text: b.text, orderId: b.orderId, targetId: b.targetId, componentId: b.componentId });
        return json({ ok: true, queued: u.queue.length });
      }
      if (m === "PATCH" && !parts[2]) {
        const b = await body<{ team: number | null }>(req);
        if ("team" in b) {
          u.team = b.team ?? null;
          saveUnits();
        }
        return json({ ok: true });
      }
      if (m === "DELETE" && !parts[2]) {
        retire(u);
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
    spendBase ??= await orgSpend().catch(() => null);
    console.log(`[qm-bridge] QM principal ${p}; harnesses ${cfg.approvedHarnesses?.join(",")}; codex models ${codexModels.join(",")}`);
  })
  .catch((err) => console.warn(`[qm-bridge] QM not reachable yet: ${String(err?.message ?? err)}`));
