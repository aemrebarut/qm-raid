// qm-bridge: Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 backed by real QM agents, one QM conversation per unit.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BridgeEvent, CatalogItem, Loadout, SendRequest, SpawnRequest } from "../../../contract/types.ts";
import { fetchCatalog, lastWebPost, loadoutLines, loadoutMarker, normalizeLoadout, sameLoadout, soulContent, soulMarker, soulWritten } from "./loadout.ts";
import {
  PORTAL_URL,
  createProject,
  getScopeSoul,
  putScopeSoul,
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
const TIMING_FILE = join(import.meta.dir, "..", ".state", "timing.jsonl"); // one row per finished order
// One stable QM conversation per unit: threadRef web:<principal>:raid-<ns>-<unitId>, across respawns, resets and restarts.
// Change QM_THREAD_NS to start every unit in a fresh conversation.
const THREAD_NS = process.env.QM_THREAD_NS ?? "r1";
// Plan B (flag): each unit gets its own QM project scope; a loadout change makes the agent write that scope's SOUL.
// LOADOUT_SOUL=1 turns it on for every new unit; any other non-empty value is a unit id prefix (qmtest-) so plan B
// can be tried on test units while the demo units stay on plan A.
const SOUL_FLAG = process.env.LOADOUT_SOUL ?? "";
const soulFor = (id: string): boolean => SOUL_FLAG === "1" || (SOUL_FLAG !== "" && SOUL_FLAG !== "0" && id.startsWith(SOUL_FLAG));
const ROUND_MARKER = "New round: the board was reset. Recall from GBrain before each order. Reply with one short line.";

interface Send extends SendRequest {
  intro?: boolean;
  soul?: boolean; // plan B SOUL write: applied only when the run shows HTTP 200
  key?: string; // idempotency key, persisted, so retries and post-crash re-sends never start a second run
  t?: { send: number; depth: number; queued?: number; first?: number }; // per-order timing (epoch ms)
}
interface Unit extends SpawnRequest {
  loadout?: Loadout;
  scopeId?: string; // plan B: group:web-project-<id>
  threadRef: string;
  sessionId: string | null;
  queue: Send[];
  active: { runId: string; send: Send } | null;
}

const units = new Map<string, Unit>();
const retired = new Set<string>(); // deleted unit ids; their next spawn opens a new round in the same conversation
const projects = new Map<string, { projectId: string; scopeId: string }>(); // plan B: unitId -> its QM project, kept across DELETE
const lastWork = new Map<string, number>(); // unitId -> last time it had a run (usage attribution)
const alive = (u: Unit): boolean => units.get(u.id) === u;

function saveUnits(): void {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    const undelivered = backlog.filter(isTerminal); // terminals nobody has received yet survive a bridge restart
    const state = { units: [...units.values()], retired: [...retired], undelivered, projects: Object.fromEntries(projects) };
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  } catch (err) {
    console.warn(`[qm-bridge] cannot save unit map: ${String((err as Error)?.message ?? err)}`);
  }
}

function loadUnits(): void {
  try {
    const saved = JSON.parse(readFileSync(STATE_FILE, "utf8")) as
      | { units?: Unit[]; retired?: string[]; undelivered?: BridgeEvent[]; projects?: Record<string, { projectId: string; scopeId: string }> }
      | Unit[];
    const rows = Array.isArray(saved) ? saved : (saved.units ?? []);
    for (const id of Array.isArray(saved) ? [] : (saved.retired ?? [])) retired.add(id);
    backlog.push(...(Array.isArray(saved) ? [] : (saved.undelivered ?? [])));
    for (const [id, p] of Object.entries(Array.isArray(saved) ? {} : (saved.projects ?? {}))) projects.set(id, p);
    if (backlog.length) console.log(`[qm-bridge] restored ${backlog.length} undelivered terminal event(s)`);
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
        u.active = null; // crashed before QM accepted the turn: send it again (same key, so QM dedupes)
        u.queue.unshift(a.send);
      }
    }
    // Restored queues are pumped once the model catalog is loaded (see boot), so they keep their unit's model.
  } catch {
    // no saved state yet
  }
}
let codexModels: string[] = [];
let booted = false; // new turns wait for the model catalog, or 15 s, so model/effort are never dropped at boot
const CODEX_EFFORTS = ["auto", "low", "medium", "high", "xhigh"];

// ---------- SSE fan-out ----------
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
// Observers (GET /events?observe=1: watch scripts, reviewers) see every event but never count as delivery and get no replay,
// so a watcher left running cannot swallow terminals the engine would otherwise get from the backlog.
const observers = new Set<ReadableStreamDefaultController<Uint8Array>>();

function send(set: Set<ReadableStreamDefaultController<Uint8Array>>, line: Uint8Array): boolean {
  let ok = false;
  for (const c of set) {
    try {
      c.enqueue(line);
      ok = true;
    } catch {
      set.delete(c);
    }
  }
  return ok;
}
const enc = new TextEncoder();

// Events emitted while no client is connected (engine restarting, bridge just restarted) are replayed to the next client.
// Terminal events (reply, error) in it are also persisted in .state, so an order's terminal survives a bridge restart.
const backlog: BridgeEvent[] = [];
const isTerminal = (ev: BridgeEvent): boolean => ev.type === "reply" || ev.type === "error";
const sse = (ev: BridgeEvent): Uint8Array => enc.encode(`data: ${JSON.stringify(ev)}\n\n`);

function emit(ev: BridgeEvent): void {
  const line = sse(ev);
  send(observers, line);
  if (send(clients, line)) return;
  backlog.push(ev);
  if (backlog.length > 500) {
    const drop = backlog.findIndex((e) => !isTerminal(e)); // drop chatter before terminals
    backlog.splice(drop >= 0 ? drop : 0, 1);
  }
  if (isTerminal(ev)) saveUnits();
}
setInterval(() => {
  const ping = enc.encode(": ping\n\n");
  send(clients, ping);
  send(observers, ping);
}, 15_000);

function activity(u: Unit, send: Send, kind: "message" | "tool" | "thinking" | "error", text: string, extra: { tool?: string; args?: unknown } = {}): void {
  if (!alive(u)) return; // deleted or replaced units stay silent
  if (send.t && !send.t.first) send.t.first = Date.now();
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
  // Standing orders and loadout are restated on every order, so they hold whatever QM keeps as its session prompt.
  return [`[${tags.join(" | ")}]`, ...loadoutLines(u.loadout), s.text].join("\n");
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[qm-bridge] ${msg}`);
}

function turnOptions(u: Unit, s: Send): { model?: string; thinkingLevel?: string; idempotencyKey?: string; scopeId?: string } {
  // Allowed Codex models pass; with the catalog still unloaded (15 s boot fallback), gpt-* names pass too and QM
  // refuses a bad one (error terminal). Anything else (claude-* etc.) runs on QM's default model, with a warning.
  const model = codexModels.includes(u.model) || (!codexModels.length && /^gpt-/.test(u.model)) ? u.model : undefined;
  if (u.model && !model) warnOnce(`unit ${u.id}: model ${u.model} is not an allowed Codex model, QM default used`);
  return {
    ...(s.key ? { idempotencyKey: s.key } : {}),
    ...(model ? { model } : {}),
    ...(CODEX_EFFORTS.includes(u.effort) ? { thinkingLevel: u.effort } : {}),
    ...(u.scopeId ? { scopeId: u.scopeId } : {}),
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
  if (s.t) s.t.queued = Date.now();
  lastWork.set(u.id, Date.now());
  if (alive(u)) saveUnits();
  void follow(u, s, runId);
}

function pump(u: Unit): void {
  if (!booted || u.active || u.queue.length === 0 || !alive(u)) return;
  const s = u.queue.shift()!;
  begin(u, s).catch((err) => finish(u, s, { ok: false, text: `QM unavailable: ${String(err?.message ?? err)}` }));
}

// Exactly one terminal event per send.
function finish(u: Unit, s: Send, outcome: { ok: boolean; text: string }): void {
  if (!u.active || u.active.send !== s) return;
  u.active = null;
  lastWork.set(u.id, Date.now());
  if (!alive(u)) return;
  // Emit before saving: a crash in between repeats the terminal (engine ignores it for a finished order) instead of losing it.
  if (s.intro) {
    // The intro is not an order: its text was streamed as chat; never a terminal event.
    if (!outcome.ok) activity(u, s, "error", outcome.text);
    else if (s.soul) activity(u, s, "message", outcome.text);
  } else if (outcome.ok) {
    emit({ type: "reply", unitId: u.id, ...(s.orderId ? { orderId: s.orderId } : {}), text: outcome.text });
  } else {
    emit({ type: "error", unitId: u.id, ...(s.orderId ? { orderId: s.orderId } : {}), text: outcome.text });
  }
  saveUnits();
  if (s.t) logTiming(u, s);
  pump(u);
}

// Per-order timing: send = POST /send received, queued = QM accepted the turn, first = first activity, terminal = reply/error.
const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, "0")}`; // local time, like the milestones
};

function logTiming(u: Unit, s: Send): void {
  const t = s.t!;
  const terminal = Date.now();
  const rel = (x?: number) => (x ? `+${((x - t.send) / 1000).toFixed(1)}s` : "-");
  console.log(
    `[qm-bridge] timing unit=${u.id} order=${s.orderId ?? "-"} depth=${t.depth} send=${clock(t.send)} ` +
      `queued=${rel(t.queued)} first=${rel(t.first)} terminal=${rel(terminal)}`,
  );
  try {
    appendFileSync(TIMING_FILE, `${JSON.stringify({ unitId: u.id, orderId: s.orderId ?? null, depth: t.depth, t_send: t.send, t_queued: t.queued ?? null, t_first_event: t.first ?? null, t_terminal: terminal })}\n`);
  } catch {
    // timing is diagnostics only
  }
}

function outcomeOf(run: RunState, s?: Send): { ok: boolean; text: string } {
  const r = run.result;
  if (s?.soul) {
    // Plan B loadout: applied only when the SOUL write printed HTTP 200.
    return soulWritten(run.activity) ? { ok: true, text: "Loadout applied: SOUL written" } : { ok: false, text: "Loadout SOUL write failed (no HTTP 200)" };
  }
  if (r?.status === "ok") return { ok: true, text: r.reply ?? run.partial ?? "" };
  if (r?.status === "silent") {
    // Group-scope (plan B) turns answer with a web post and end silent.
    const post = lastWebPost(run.activity);
    return post ? { ok: true, text: post } : { ok: false, text: "QM run ended silent without a reply" };
  }
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
            if (ev.toolCallName === "finish_silently") continue; // group-scope bookkeeping, not work
            if (ev.toolCallName === "web" && ev.args?.action === "post" && typeof ev.args.text === "string") {
              text = ev.args.text; // group-scope reply: shown as chat, not as a tool
              flushed = 0;
              flush(true);
              continue;
            }
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
        const out = outcomeOf(run, s);
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
    (u.loadout ? `${loadoutLines(u.loadout).join(" ")} ` : "") +
    `Reply to this message with one short line saying you are ready.`
  );
}

// Loadout change: one visible marker turn, queued behind any active order (never interrupts); no terminal event.
// Plan B units first get their scope SOUL replaced, so the new standing orders are in the system prompt of every turn.
async function applyLoadout(u: Unit, next: Loadout | null): Promise<boolean> {
  if (!next || sameLoadout(u.loadout, next)) return false;
  u.loadout = next;
  if (u.scopeId) await writeSoul(u, next);
  enqueue(u, { text: loadoutMarker(next), intro: true });
  return true;
}

// Plan B: SOUL through the admin relay (deterministic, no agent turn), applied only when a read-back matches; if
// that fails, the agent writes it itself.
async function writeSoul(u: Unit, l: Loadout): Promise<void> {
  const content = soulContent(l);
  try {
    await putScopeSoul(u.scopeId!, content);
    const back = await getScopeSoul(u.scopeId!);
    if (back?.trim() !== content.trim()) throw new Error("read-back does not match");
    activity(u, { text: "" }, "message", "Loadout applied: standing orders are now this unit's QM scope SOUL");
  } catch (err) {
    console.warn(`[qm-bridge] ${u.id} SOUL via admin failed, asking the agent: ${String((err as Error)?.message ?? err)}`);
    enqueue(u, { text: soulMarker(l), intro: true, soul: true });
  }
}

let catalogCache: { at: number; items: CatalogItem[] } | null = null;
async function catalogItems(): Promise<CatalogItem[]> {
  if (catalogCache && Date.now() - catalogCache.at < 30_000) return catalogCache.items;
  const items = await fetchCatalog();
  catalogCache = { at: Date.now(), items };
  return items;
}

async function createUnit(b: Partial<SpawnRequest> & { id: string; loadout?: Loadout }): Promise<Unit> {
  const u: Unit = {
    id: b.id,
    name: b.name ?? b.id,
    model: b.model ?? "",
    effort: b.effort ?? "",
    role: b.role ?? "worker",
    team: b.team ?? null,
    ...(b.loadout ? { loadout: b.loadout } : {}),
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
  const b = await body<SpawnRequest & { loadout?: unknown }>(req);
  if (!b.id) return json({ ok: false, error: "id required" }, 400);
  const loadout = normalizeLoadout(b.loadout); // optional, so the engine's 404 re-spawn keeps it
  const existing = units.get(b.id);
  if (existing) {
    // Same unit again (engine restart, re-spawn without delete): keep the conversation, refresh settings, no extra
    // turn unless the loadout changed.
    existing.name = b.name ?? existing.name;
    existing.model = b.model ?? existing.model;
    existing.effort = b.effort ?? existing.effort;
    existing.role = b.role ?? existing.role;
    if ("team" in b) existing.team = b.team ?? null;
    await applyLoadout(existing, loadout);
    existing.sessionId ??= await findSessionId(existing.threadRef).catch(() => null);
    saveUnits();
    return json({ sessionId: existing.sessionId, sessionUrl: existing.sessionId ? sessionUrl(existing.sessionId) : null });
  }
  await catalog;
  let u: Unit | null = null;
  try {
    u = await createUnit({ ...b, id: b.id, ...(loadout ? { loadout } : {}) });
    if (soulFor(u.id)) {
      // Own project scope per unit, created once and reused on respawn (its SOUL survives DELETE).
      let p = projects.get(u.id);
      if (!p) {
        p = await createProject(`${u.name} (${u.id})`);
        projects.set(u.id, p);
      }
      u.scopeId = p.scopeId;
      if (u.loadout) await writeSoul(u, u.loadout); // before the intro, so its first turn already runs with the SOUL
    }
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
let spendPolling = false; // single flight: a slow spend call never overlaps the next tick
setInterval(async () => {
  if (spendPolling) return;
  spendPolling = true;
  try {
    const now = Date.now();
    for (const u of units.values()) if (u.active) lastWork.set(u.id, now);
    for (const id of lastWork.keys()) if (!units.has(id)) lastWork.delete(id); // deleted units get no usage
    const recent = [...lastWork].filter(([, t]) => now - t < USAGE_WINDOW_MS).map(([id]) => id);
    const cur = await orgSpend();
    const working = recent.filter((id) => units.has(id)); // re-check after the await: a unit deleted meanwhile gets no share
    const base = spendBase;
    const tokens = base ? cur.tokens - base.tokens : 0;
    const usd = base ? cur.costUsd - base.costUsd : 0;
    // Baseline only moves forward; spend accrued with nobody working is absorbed, not attributed later.
    if (!base || tokens < 0 || usd < 0 || working.length === 0) {
      if (!base || cur.tokens >= base.tokens) spendBase = cur;
      return;
    }
    if (tokens === 0 && usd === 0) return;
    spendBase = cur;
    // Integer token split; the remainder goes to the last unit so the parts sum to the org delta.
    const each = Math.floor(tokens / working.length);
    const eachUsd = usd / working.length;
    working.forEach((unitId, i) => {
      const last = i === working.length - 1;
      emit({
        type: "usage",
        unitId,
        tokens: last ? tokens - each * (working.length - 1) : each,
        usd: last ? usd - eachUsd * (working.length - 1) : eachUsd,
      });
    });
  } catch {
    // spend is optional; ignore while QM is unreachable
  } finally {
    spendPolling = false;
  }
}, 5_000);

// Model catalog (runtime-config) and principal, retried every second until QM answers.
async function loadCatalog(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const p = await principal();
      const cfg = await runtimeConfig();
      codexModels = cfg.modelsByHarness?.codex ?? [];
      spendBase ??= await orgSpend().catch(() => null);
      console.log(`[qm-bridge] QM principal ${p}; harnesses ${cfg.approvedHarnesses?.join(",")}; codex models ${codexModels.join(",")}`);
      return;
    } catch (err) {
      if (attempt === 0) console.warn(`[qm-bridge] QM not reachable yet: ${String((err as Error)?.message ?? err)}`);
      await Bun.sleep(1_000);
    }
  }
}
const catalog = Promise.race([loadCatalog(), Bun.sleep(15_000)]);

loadUnits();

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const m = req.method;

    if (m === "GET" && url.pathname === "/catalog") return json({ items: await catalogItems() });
    if (m === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "qm-bridge", qm: PORTAL_URL, units: units.size });
    }
    if (m === "GET" && url.pathname === "/events") {
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const set = url.searchParams.get("observe") === "1" ? observers : clients;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c;
          set.add(c);
          c.enqueue(enc.encode(": open\n\n"));
          if (set === observers) return;
          const replay = backlog.splice(0);
          for (const ev of replay) c.enqueue(sse(ev));
          if (replay.length) {
            console.log(`[qm-bridge] replayed ${replay.length} buffered event(s) to a new /events client`);
            if (replay.some(isTerminal)) saveUnits();
          }
        },
        cancel() {
          set.delete(ctl);
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
        const t = { send: Date.now(), depth: u.queue.length + (u.active ? 1 : 0) }; // depth = sends ahead of this one
        enqueue(u, { text: b.text, orderId: b.orderId, targetId: b.targetId, componentId: b.componentId, t });
        return json({ ok: true, queued: u.queue.length });
      }
      if (m === "PATCH" && !parts[2]) {
        // {team?, loadout?, model?, effort?}: model/effort apply from the next turn (unknown models run on QM's
        // default, with a warning); a changed loadout queues one marker turn.
        const b = await body<{ team: number | null; loadout: unknown; model: string; effort: string }>(req);
        if ("team" in b) u.team = b.team ?? null;
        if (typeof b.model === "string" && b.model) u.model = b.model;
        if (typeof b.effort === "string" && b.effort) u.effort = b.effort;
        if ("loadout" in b) {
          const next = normalizeLoadout(b.loadout);
          if (!next) return json({ ok: false, error: "loadout must be {instructions, skills, plugins}" }, 400);
          await applyLoadout(u, next);
        }
        saveUnits();
        return json({
          ok: true,
          loadout: u.loadout ?? null,
          model: u.model,
          effort: u.effort,
          sessionUrl: u.sessionId ? sessionUrl(u.sessionId) : null,
        });
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
function boot(): void {
  if (booted) return;
  booted = true;
  for (const u of units.values()) pump(u);
}
void catalog.then(boot);
