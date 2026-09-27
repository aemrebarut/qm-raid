// Game rules: world loading, orders, movement, teams, and mapping bridge events to engine events.
import type { BridgeEvent, Customer, MemoryOp, Order, Pos, Proposal, State, Target, Team, Unit, Workflow, World } from "../../../contract/types.ts";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { readSaved, saveNow, startSaving } from "./persist.ts";
import { AUTOPILOT_EVERY_MS, BRAIN_RESET, BRAIN_URL, BRIDGE_URL, CLASS_MODELS, FORGE_URL, GRID, MEMORY_ANIM_MS, MEMORY_RECENT_MAX, PROPOSER_URL, STATE_FILE, TILES_PER_SEC, VETO_LOG, VETO_WINDOW_MS } from "./config.ts";
import { defaultLoadout, fixtureState, fixtureUnits } from "./fixture.ts";
import { emit, store } from "./store.ts";
import { getJson, logOnce, sendJson } from "./http.ts";
import { forgeType, pollForge, startForge } from "./forge.ts";
import { flow, linkWorkflows, type NodeBrief } from "./flowlink.ts";
import { bridgeFor, deleteOnBridge, followBridgeEvents, patchOnBridge, sendToBridge, spawnOnBridge } from "./bridge.ts";

type Result = { ok: true; [k: string]: unknown } | { ok: false; error: string; status?: number };
const fail = (error: string, status = 400): Result => ({ ok: false, error, status });

// Per-unit runtime data that is not part of the contract state.
interface Runtime { dest: Pos | null; spawned: boolean; spawning: Promise<boolean> | null; sentOrderId: string | null; learningSlug: string | null; gbrainCalls: number; gbrainReads: number; gbrainWrites: number; animTimer: ReturnType<typeof setTimeout> | null }
const rt = new Map<string, Runtime>();
function runtime(unitId: string): Runtime {
  let r = rt.get(unitId);
  if (!r) { r = { dest: null, spawned: false, spawning: null, sentOrderId: null, learningSlug: null, gbrainCalls: 0, gbrainReads: 0, gbrainWrites: 0, animTimer: null }; rt.set(unitId, r); }
  return r;
}

let customers = new Map<string, Customer>();
// Team workflows: the brief (role, instructions, previous replies) for each workflow order, used in its prompt.
const briefs = new Map<string, NodeBrief>();
// Autopilot: per-unit work history for /propose, and the proposal context per proposed order for the veto log.
const history = new Map<string, { targetId: string; component: string }[]>();
type ProposeContext = { units: unknown[]; targets: unknown[]; memory: string };
const proposals = new Map<string, { proposal: Proposal; context: ProposeContext }>();
let nextOrder = 1;
let nextUnit = 1;
// True while POST /api/reset runs: the old world is already dead and nothing may start, walk or send.
let resetting = false;
export const isResetting = () => resetting;
const TEAM_COLORS = ["#d64545", "#3b7dd8", "#3fa34d", "#d4a017"];
const TEAM_NAMES = ["Red", "Blue", "Green", "Gold"];

const S = () => store.state;
const unitById = (id: string) => S().units.find((u) => u.id === id);
const targetById = (id: string) => S().targets.find((t) => t.id === id);
const orderById = (id: string) => S().orders.find((o) => o.id === id);
const teamById = (id: number) => S().teams.find((t) => t.id === id);

function backendName(): string {
  if (BRIDGE_URL.endsWith(":4614")) return "qm";
  if (BRIDGE_URL.endsWith(":4615")) return "mock";
  return BRIDGE_URL;
}

// ---------- world ----------

function inZone(t: Target): Pos {
  const c = S().components.find((c) => c.id === t.component);
  if (!c) return { x: 12, y: 12 };
  return { x: c.zone.x + Math.floor(c.zone.w / 2), y: c.zone.y + Math.floor(c.zone.h / 2) };
}

async function loadWorld(): Promise<void> {
  const state = fixtureState();
  state.backend = backendName();
  store.state = state;
  customers = new Map();
  const world = await getJson<World>(`${BRAIN_URL}/world`, 4000);
  if (world && Array.isArray(world.components) && world.components.length && Array.isArray(world.targets)) {
    state.components = world.components;
    if (Array.isArray(world.buildings) && world.buildings.length) state.buildings = world.buildings;
    state.targets = world.targets.map((t) => ({
      ...t, issue: String(t.issue), status: "open", customers: Array.isArray(t.customers) ? t.customers : [],
      pos: t.pos && Number.isFinite(t.pos.x) && Number.isFinite(t.pos.y) ? t.pos : inZone(t),
    }));
    for (const c of world.customers ?? []) customers.set(c.id, c);
    console.log(`[engine] world from brain: ${state.components.length} components, ${state.targets.length} targets, ${customers.size} customers`);
  } else {
    console.warn(`[engine] brain /world unavailable at ${BRAIN_URL}; using local fixture world`);
  }
  const stats = await getJson<{ pages: number }>(`${BRAIN_URL}/stats`, 2000);
  if (stats && typeof stats.pages === "number") state.memory.pages = stats.pages;
  nextUnit = state.units.length + 1;
  unblockUnits(false); // the snapshot after load carries the positions
  // nextOrder is never reset: order ids stay unique across /api/reset, so late pre-reset replies cannot match.
}

// ---------- bridge ----------

async function ensureSpawned(u: Unit): Promise<boolean> {
  const r = runtime(u.id);
  if (r.spawned) return true;
  if (!r.spawning) {
    r.spawning = (async () => {
      const res = await spawnOnBridge(u);
      if (!res) return false;
      if (unitById(u.id) !== u) {
        // Retired (or replaced by a reset) while the bridge was registering it: do not leak the session.
        if (!unitById(u.id)) void deleteOnBridge(u);
        return false;
      }
      r.spawned = true;
      u.qm = { sessionId: res.sessionId, sessionUrl: res.sessionUrl };
      emit("unit.updated", { unit: u });
      return true;
    })().finally(() => { r.spawning = null; });
  }
  return r.spawning;
}

// Every bridge (re)connect: register its units. A restarted bridge dropped its sessions, so idle units re-POST
// (idempotent on every bridge) and get fresh session links; units mid-order keep the lazy 404 -> re-POST path.
function resyncUnits(base: string): void {
  for (const u of S().units) {
    if (bridgeFor(u) !== base) continue;
    const r = runtime(u.id);
    if (u.status === "idle" && !u.orderId && !r.spawning) r.spawned = false;
    void ensureSpawned(u);
  }
}

function orderPrompt(u: Unit, o: Order, t: Target, learningSlug: string): string {
  const issue = t.issue.toLowerCase();
  const pages = [`components/${t.component}`, `issues/${issue}`, ...t.customers.map((c) => `companies/${c}`)];
  // The unit's standing orders ride in every order header, so they hold even if QM keeps an older session prompt.
  const standing = u.loadout?.instructions?.trim();
  return [
    `Order ${o.id}: work on issue ${t.issue} "${t.title}" (${t.kind}, severity ${t.severity}).`,
    ...(standing ? [`Standing orders: ${standing}`] : []),
    `Component: ${t.component}`,
    `Customers: ${t.customers.join(", ")}`,
    `GBrain pages: ${pages.join(", ")}`,
    `Lumen is a synthetic product with no code checkout; GBrain is your only source. 1) Recall first: call the gbrain recall tool with componentId ${t.component}, targetId ${t.id} and unitId ${u.id}, and search GBrain for house rules and past learnings on this component. 2) Decide the fix and say it in 3 to 5 sentences, naming any rule you applied. Name the slug of every past learning you applied. 3) Remember: call the gbrain remember tool with slug ${learningSlug}, targetId ${t.id}, unitId ${u.id} and one or two sentences of what you learned. Reply in at most 4 sentences.`,
  ].join("\n");
}

// Workflow orders: normal prompt + "Role: <role>. <instructions>" + "Previous work:" (latest last).
function briefText(b: NodeBrief | undefined): string {
  if (!b) return "";
  const lines = [``, `Role: ${b.role}. ${b.instructions}`];
  if (b.previous.length) {
    lines.push(`Previous work:`);
    for (const p of b.previous) lines.push(`- ${p.role} (${p.unitId}): ${p.reply.trim()}`);
  }
  return lines.join("\n");
}

async function dispatchOrder(u: Unit, o: Order): Promise<void> {
  const t = targetById(o.targetId);
  if (!t) return failOrder(o, "target vanished");
  const r = runtime(u.id);
  r.sentOrderId = o.id;
  r.gbrainCalls = 0;
  r.gbrainReads = 0;
  r.gbrainWrites = 0;
  r.learningSlug = `learnings/${t.issue}-${u.id}-${Date.now()}`.toLowerCase();
  const req = { text: orderPrompt(u, o, t, r.learningSlug) + briefText(briefs.get(o.id)), orderId: o.id, targetId: t.id, componentId: t.component };
  // Every await may see a cancel, retire, adjust or reset: re-check before each send.
  const current = () => isLive(o) && o.status === "active" && unitById(u.id) === u && u.orderId === o.id;
  const spawned = await ensureSpawned(u);
  if (!current()) return;
  if (!spawned) return failOrder(o, `bridge unavailable at ${bridgeFor(u)}`);
  let status = await sendToBridge(u, req);
  if (status === 404 && current()) {
    // Bridge restarted and forgot the unit: spawn again and retry once.
    r.spawned = false;
    const again = await ensureSpawned(u);
    if (!current()) return;
    if (again) status = await sendToBridge(u, req);
  }
  if (status < 200 || status >= 300) failOrder(o, `bridge send failed (status ${status})`);
}

function setUnitStatus(u: Unit, status: Unit["status"]): void {
  if (u.status === status) return;
  u.status = status;
  emit("unit.status", { unitId: u.id, status });
}

function refreshTarget(t: Target | undefined, resolved = false): void {
  if (!t) return;
  const engaged = S().orders.some((o) => o.targetId === t.id && o.status === "active");
  const next: Target["status"] = resolved ? "resolved" : engaged ? "engaged" : t.status === "resolved" ? "resolved" : "open";
  if (next !== t.status) {
    t.status = next;
    emit("target.updated", { target: t });
  }
}

function releaseUnit(o: Order): void {
  const u = unitById(o.unitId);
  if (!u || u.orderId !== o.id) return;
  const r = runtime(u.id);
  r.dest = null;
  if (r.animTimer) { clearTimeout(r.animTimer); r.animTimer = null; }
  u.orderId = null;
  u.status = "idle";
  emit("unit.updated", { unit: u });
  emit("unit.status", { unitId: u.id, status: u.status });
}

// An order object from before a reset is no longer in the state; late async work on it must not emit.
const isLive = (o: Order) => orderById(o.id) === o;

function completeOrder(o: Order, reply: string): void {
  if (o.status !== "active" || !isLive(o)) return;
  const r = runtime(o.unitId);
  const used = { reads: r.gbrainReads, writes: r.gbrainWrites };
  o.status = "done";
  o.reply = reply;
  emit("order.updated", { order: o });
  releaseUnit(o);
  const t = targetById(o.targetId);
  if (t) {
    const h = history.get(o.unitId) ?? [];
    h.push({ targetId: t.id, component: t.component });
    history.set(o.unitId, h.slice(-10));
  }
  // A workflow step does not resolve the target; the run does (setTargetStatus) when its last node finishes.
  if (o.source === "workflow") flowEnded(o);
  refreshTarget(t, o.source !== "workflow");
  void brainFallback(o, reply, used);
}

// E7: when the agent made no gbrain read (or write) call for this order, the engine does it through the brain service.
async function brainFallback(o: Order, reply: string, used: { reads: number; writes: number }): Promise<void> {
  const t = targetById(o.targetId);
  if (!t) return;
  // A reset may start during any await: then the order is gone and nothing more is written or shown.
  const alive = () => !resetting && isLive(o);
  if (used.reads === 0) {
    const res = await sendJson<{ slugs?: string[]; context?: string }>("POST", `${BRAIN_URL}/recall`, { componentId: t.component, targetId: t.id, unitId: o.unitId });
    if (!alive()) return;
    if (res.status === 200 && res.data) {
      const slugs = Array.isArray(res.data.slugs) ? res.data.slugs.filter((x) => typeof x === "string") : [];
      const summary = `Recalled ${slugs.length} pages for ${t.issue} (engine fallback)`;
      pushMemory({ ts: Date.now(), unitId: o.unitId, op: "recall", slugs, summary });
      emit("memory.recall", { unitId: o.unitId, slugs, summary });
    } else logOnce("fallback:recall", `brain /recall fallback failed (status ${res.status})`);
  }
  if (used.writes === 0 && reply.trim()) {
    const res = await sendJson<{ slug?: string }>("POST", `${BRAIN_URL}/remember`, { unitId: o.unitId, targetId: t.id, text: reply });
    if (!alive()) return;
    if (res.status === 200 && res.data && typeof res.data.slug === "string") {
      const summary = `Remembered the outcome of ${t.issue} (engine fallback)`;
      pushMemory({ ts: Date.now(), unitId: o.unitId, op: "remember", slugs: [res.data.slug], summary });
      emit("memory.remember", { unitId: o.unitId, slug: res.data.slug, summary });
      void refreshPages();
    } else logOnce("fallback:remember", `brain /remember fallback failed (status ${res.status})`);
  }
}

function failOrder(o: Order, reason: string): void {
  if ((o.status !== "active" && o.status !== "proposed") || !isLive(o)) return;
  o.status = "failed";
  o.reply = reason;
  emit("unit.activity", { unitId: o.unitId, orderId: o.id, kind: "error", text: reason });
  emit("order.updated", { order: o });
  releaseUnit(o);
  if (o.source === "workflow") flowEnded(o);
  refreshTarget(targetById(o.targetId));
}

// The order a terminal bridge event refers to, or null when it is stale (cancelled or superseded).
// Contract v3: orders always carry orderId, so an orderless terminal event belongs to a chat.
function currentOrderFor(u: Unit, orderId: string | undefined): Order | null {
  if (!orderId || !u.orderId || orderId !== u.orderId) return null;
  const o = orderById(u.orderId);
  return o && o.status === "active" ? o : null;
}

function argStrings(args: any, keys: string[]): string[] {
  if (!args || typeof args !== "object") return [];
  const out: string[] = [];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && v) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.push(x); else if (x && typeof x.slug === "string") out.push(x.slug);
  }
  return out;
}

function pushMemory(op: MemoryOp): void {
  const m = S().memory;
  m.recent.push(op);
  if (m.recent.length > MEMORY_RECENT_MAX) m.recent.splice(0, m.recent.length - MEMORY_RECENT_MAX);
}

// Shows recalling / remembering for a moment, then back to working while the order runs.
// Current-order calls, and chat calls (Recall / Remember buttons, no orderId), show recalling / remembering
// for a moment, then back to working or idle. Stale-order calls and walking units never change status.
function memoryAnim(u: Unit, status: "recalling" | "remembering", orderId: string | undefined): void {
  if (orderId && orderId !== u.orderId) return;
  if (!["idle", "working", "recalling", "remembering"].includes(u.status)) return;
  const r = runtime(u.id);
  setUnitStatus(u, status);
  if (r.animTimer) clearTimeout(r.animTimer);
  r.animTimer = setTimeout(() => {
    r.animTimer = null;
    if (u.status === "recalling" || u.status === "remembering") setUnitStatus(u, u.orderId ? "working" : "idle");
  }, MEMORY_ANIM_MS);
}

// Team rule: substring match so MCP name variants (mcp__gbrain__put_page, gbrain_search) classify too.
function classifyGbrain(tool: string): "link" | "remember" | "recall" {
  const n = tool.toLowerCase();
  if (n.includes("link")) return "link";
  if (["put", "remember", "write", "capture", "add_page"].some((k) => n.includes(k))) return "remember";
  return "recall";
}

// Explicit slugs first, then the raid-gbrain facade ids (componentId, targetId), else slugs named in the query.
function slugsFrom(args: any): string[] {
  const out = argStrings(args, ["slugs", "slug", "page", "from", "to"]);
  const cid = argStrings(args, ["componentId"])[0];
  if (cid) out.push(`components/${cid}`);
  const t = targetById(argStrings(args, ["targetId"])[0] ?? "");
  if (t) out.push(`issues/${t.issue.toLowerCase()}`, ...t.customers.map((c) => `companies/${c}`));
  if (!out.length) {
    const q = argStrings(args, ["query", "q"])[0] ?? "";
    out.push(...(q.match(/[a-z]+\/[a-z0-9][a-z0-9._-]*/gi) ?? []));
    // A plain search like "billing" still points the recall beam at the component page.
    const words = new Set(q.toLowerCase().split(/[^a-z0-9-]+/));
    for (const c of S().components) if (words.has(c.id.toLowerCase()) || words.has(c.name.toLowerCase())) out.push(`components/${c.id}`);
  }
  return [...new Set(out)];
}

function handleGbrainTool(u: Unit, tool: string, rawArgs: any, text: string, orderId: string | undefined): void {
  // qm-bridge may nest MCP call args as {mcpServer, args: {...}}.
  const args = rawArgs && typeof rawArgs === "object" && rawArgs.args && typeof rawArgs.args === "object" ? { ...rawArgs, ...rawArgs.args } : rawArgs;
  const op = classifyGbrain(tool);
  // Counters feed the fallback (E7); a throwaway record absorbs stale or chat calls.
  const current = !!orderId && orderId === u.orderId;
  const r = current ? runtime(u.id) : { gbrainCalls: 0, gbrainReads: 0, gbrainWrites: 0 };
  r.gbrainCalls++;
  if (op === "link") {
    const from = argStrings(args, ["from", "source"])[0] ?? "";
    const to = argStrings(args, ["to", "target"])[0] ?? "";
    const linkType = argStrings(args, ["linkType", "link_type", "type"])[0] ?? "related";
    pushMemory({ ts: Date.now(), unitId: u.id, op: "link", slugs: [from, to].filter(Boolean), summary: text });
    emit("memory.link", { from, to, linkType });
    memoryAnim(u, "remembering", orderId);
  } else if (op === "remember") {
    r.gbrainWrites++;
    const slug = slugsFrom(args)[0] ?? "";
    const summary = text || argStrings(args, ["title", "text"])[0]?.slice(0, 200) || slug;
    pushMemory({ ts: Date.now(), unitId: u.id, op: "remember", slugs: slug ? [slug] : [], summary });
    S().memory.pages++;
    emit("memory.remember", { unitId: u.id, slug, summary });
    memoryAnim(u, "remembering", orderId);
    if (mirrorsToBrain(u)) void mirrorRemember(u, args, text, slug, orderId);
    else void refreshPages();
  } else {
    r.gbrainReads++;
    const slugs = slugsFrom(args);
    const summary = text || argStrings(args, ["query", "q"])[0] || slugs.join(", ");
    pushMemory({ ts: Date.now(), unitId: u.id, op: "recall", slugs, summary });
    emit("memory.recall", { unitId: u.id, slugs, summary });
    memoryAnim(u, "recalling", orderId);
  }
}

// E16: mock agents only pretend to write GBrain, so the engine writes their learnings for real.
function mirrorsToBrain(u: Unit): boolean {
  return backendName() === "mock" && bridgeFor(u) === BRIDGE_URL;
}

async function mirrorRemember(u: Unit, args: any, text: string, slug: string, orderId: string | undefined): Promise<void> {
  if (resetting) return; // never write into the brain while it is being reset
  const world = S();
  const targetId = argStrings(args, ["targetId"])[0] ?? (orderId ? orderById(orderId)?.targetId : undefined) ?? "";
  const body: Record<string, string> = { unitId: u.id, targetId, text: argStrings(args, ["text", "summary"])[0] ?? text };
  if (/^learnings\/[a-z0-9][a-z0-9._-]*$/.test(slug)) body.slug = slug;
  const res = await sendJson("POST", `${BRAIN_URL}/remember`, body, 15000);
  if (res.status !== 200) logOnce("mirror", `brain /remember mirror failed (status ${res.status})`);
  if (S() === world && !resetting) await refreshPages();
}

export async function refreshPages(): Promise<void> {
  const stats = await getJson<{ pages: number }>(`${BRAIN_URL}/stats`, 2000);
  if (stats && typeof stats.pages === "number") S().memory.pages = stats.pages;
}

export function onBridgeEvent(e: BridgeEvent): void {
  if (!e || typeof e !== "object" || typeof (e as any).unitId !== "string") return;
  const u = unitById(e.unitId);
  if (!u) return;
  switch (e.type) {
    case "activity": {
      if (e.orderId && !orderById(e.orderId)) return; // an order from before a reset
      emit("unit.activity", { unitId: u.id, orderId: e.orderId, kind: e.kind, text: e.text ?? "", tool: e.tool, args: e.args });
      if (e.kind === "tool" && typeof e.tool === "string" && /gbrain/i.test(e.tool)) handleGbrainTool(u, e.tool, e.args, e.text ?? "", e.orderId);
      break;
    }
    case "reply": {
      const o = currentOrderFor(u, e.orderId);
      if (o) completeOrder(o, e.text ?? "");
      else if (!e.orderId) emit("unit.activity", { unitId: u.id, kind: "message", text: e.text ?? "" }); // chat reply
      else logOnce(`stale:${u.id}`, `dropped stale reply for ${u.id} order ${e.orderId}`, 1000);
      break;
    }
    case "error": {
      const o = currentOrderFor(u, e.orderId);
      if (o) failOrder(o, e.text || "bridge error");
      else emit("unit.activity", { unitId: u.id, ...(e.orderId ? { orderId: e.orderId } : {}), kind: "error", text: e.text ?? "bridge error" });
      break;
    }
    case "usage": {
      const st = S().stats;
      st.tokens += Number(e.tokens) || 0;
      st.spentUsd = Math.round((st.spentUsd + (Number(e.usd) || 0)) * 10000) / 10000;
      emit("stats", { spentUsd: st.spentUsd, tokens: st.tokens });
      break;
    }
  }
}

// ---------- movement ----------

function destFor(u: Unit, t: Target): Pos {
  const taken = new Set<string>();
  for (const [id, r] of rt) if (id !== u.id && r.dest) taken.add(`${r.dest.x},${r.dest.y}`);
  for (const other of S().units) if (other.id !== u.id && other.status !== "moving") taken.add(`${other.pos.x},${other.pos.y}`);
  for (let ring = 1; ring <= 3; ring++) {
    const cands: Pos[] = [];
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const p = { x: t.pos.x + dx, y: t.pos.y + dy };
      if (p.x < 0 || p.y < 0 || p.x >= GRID || p.y >= GRID || taken.has(`${p.x},${p.y}`) || blockedTile(p)) continue;
      cands.push(p);
    }
    if (cands.length) {
      cands.sort((a, b) => Math.max(Math.abs(a.x - u.pos.x), Math.abs(a.y - u.pos.y)) - Math.max(Math.abs(b.x - u.pos.x), Math.abs(b.y - u.pos.y)));
      return cands[0]!;
    }
  }
  return { ...t.pos };
}

function tick(): void {
  if (resetting) return;
  const now = Date.now();
  unblockUnits(true);
  for (const o of S().orders) if (o.status === "proposed" && o.vetoDeadline !== null && o.vetoDeadline <= now) resolveProposal(o, "expired");
  for (const u of S().units) {
    if (u.status !== "moving") continue;
    const r = runtime(u.id);
    const o = u.orderId ? orderById(u.orderId) : undefined;
    if (!r.dest || !o || o.status !== "active") continue;
    if (u.pos.x !== r.dest.x || u.pos.y !== r.dest.y) {
      u.pos = { x: u.pos.x + Math.sign(r.dest.x - u.pos.x), y: u.pos.y + Math.sign(r.dest.y - u.pos.y) };
      emit("unit.moved", { unitId: u.id, pos: u.pos });
    }
    if (u.pos.x === r.dest.x && u.pos.y === r.dest.y) {
      r.dest = null;
      setUnitStatus(u, "working");
      void dispatchOrder(u, o);
    }
  }
}

// ---------- commands ----------

function cancelIfOpen(o: Order | undefined): void {
  if (!o || (o.status !== "active" && o.status !== "proposed")) return;
  if (o.status === "proposed") logVeto(o, "cancel");
  o.status = "cancelled";
  emit("order.updated", { order: o });
  releaseUnit(o);
  if (o.source === "workflow") flowEnded(o);
  refreshTarget(targetById(o.targetId));
}

// Tells workflow.ts that a step ended (done / failed / cancelled, reply set). May re-enter through the hooks.
function flowEnded(o: Order): void {
  briefs.delete(o.id);
  try { flow.onOrderEnded(o); } catch (err) { console.error("[engine] workflow onOrderEnded failed:", err); }
}

export function createOrders(body: any): Result {
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  const t = typeof body.targetId === "string" ? targetById(body.targetId) : undefined;
  if (!t) return fail("unknown targetId");
  if (t.status === "resolved") return fail("target already resolved");
  let ids: string[] = [];
  if (Array.isArray(body.unitIds)) ids = body.unitIds.filter((x: unknown) => typeof x === "string");
  else if (body.teamId !== undefined) {
    const team = teamById(Number(body.teamId));
    if (!team) return fail("unknown teamId");
    if (team.workflow) {
      const res = flow.startRun(team.id, t.id);
      return res.ok ? { ok: true, run: res.run } : fail(res.error);
    }
    ids = [...team.members];
  } else return fail("unitIds or teamId required");
  const units = [...new Set(ids)].map(unitById).filter((u): u is Unit => !!u);
  if (!units.length) return fail("no known units in the order");
  const orders: Order[] = [];
  for (const u of units) {
    cancelIfOpen(u.orderId ? orderById(u.orderId) : undefined);
    const o: Order = { id: `o${nextOrder++}`, unitId: u.id, targetId: t.id, status: "active", source: "user", vetoDeadline: null, reply: null };
    S().orders.push(o);
    orders.push(o);
    u.orderId = o.id;
    u.status = "moving";
    runtime(u.id).dest = destFor(u, t);
    emit("order.updated", { order: o });
    emit("unit.updated", { unit: u });
    emit("unit.status", { unitId: u.id, status: u.status });
  }
  refreshTarget(t);
  return { ok: true, orders };
}

export function cancelOrder(id: string): Result {
  const o = orderById(id);
  if (!o) return fail("unknown order", 404);
  if (o.status !== "active" && o.status !== "proposed") return fail(`order is ${o.status}`);
  // Cancelling any order of a running workflow run cancels the run (and with it its active orders).
  const run = o.source === "workflow" ? flow.runForOrder(o.id) : undefined;
  if (run && run.status === "running") {
    const res = flow.cancelRun(run.id);
    if (res.ok) { cancelIfOpen(o); return { ok: true, order: o, run }; }
  }
  cancelIfOpen(o);
  return { ok: true, order: o };
}

// ---------- team workflows (hooks for workflow.ts, team workflow routes) ----------

function startWorkflowOrder(unitId: string, targetId: string, brief: NodeBrief): string | null {
  if (resetting) return null;
  const u = unitById(unitId);
  const t = targetById(targetId);
  if (!u || !t) return null;
  cancelIfOpen(u.orderId ? orderById(u.orderId) : undefined);
  const o: Order = { id: `o${nextOrder++}`, unitId: u.id, targetId: t.id, status: "active", source: "workflow", runId: brief.runId, nodeId: brief.nodeId, vetoDeadline: null, reply: null };
  S().orders.push(o);
  briefs.set(o.id, brief);
  u.orderId = o.id;
  u.status = "moving";
  runtime(u.id).dest = destFor(u, t);
  emit("order.updated", { order: o });
  emit("unit.updated", { unit: u });
  emit("unit.status", { unitId: u.id, status: u.status });
  refreshTarget(t);
  return o.id;
}

function setTargetStatus(targetId: string, status: Target["status"]): void {
  const t = targetById(targetId);
  if (!t || t.status === status) return;
  t.status = status;
  emit("target.updated", { target: t });
}

linkWorkflows({
  startOrder: startWorkflowOrder,
  cancelOrder: (orderId) => cancelIfOpen(orderById(orderId)),
  setTargetStatus,
});


export function setTeamWorkflow(id: number, body: any): Result {
  const team = teamById(id);
  if (!team) return fail("unknown team", 404);
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  let w: Workflow;
  if (body.workflow && typeof body.workflow === "object") {
    const err = flow.validateWorkflow(body.workflow, team.members);
    if (err) return fail(err);
    w = body.workflow;
  } else if (typeof body.preset === "string" && body.preset !== "custom") { // workflow.ts knows the presets
    const res = flow.presetWorkflow(body.preset, team.members);
    if ("error" in res) return fail(res.error);
    w = res;
  } else return fail("preset (solo, pair, trio, fanout) or workflow required");
  team.workflow = w;
  emit("team.updated", { team });
  return { ok: true, team };
}

export function clearTeamWorkflow(id: number): Result {
  const team = teamById(id);
  if (!team) return fail("unknown team", 404);
  team.workflow = null;
  emit("team.updated", { team });
  return { ok: true, team };
}

// A workflow binds member units to roles; when a bound unit leaves the team, the graph no longer fits.
function dropWorkflowFor(team: Team, unitId: string): void {
  if (team.workflow?.nodes.some((n) => n.unitId === unitId)) team.workflow = null;
}

export async function messageUnit(id: string, body: any): Promise<Result> {
  const u = unitById(id);
  if (!u) return fail("unknown unit", 404);
  if (!body || typeof body.text !== "string" || !body.text.trim()) return fail("text required");
  if (!(await ensureSpawned(u))) return fail(`bridge unavailable at ${bridgeFor(u)}`, 502);
  const alive = () => !resetting && unitById(id) === u;
  if (!alive()) return fail("unit retired or reset running", 409);
  let status = await sendToBridge(u, { text: body.text });
  if (status === 404 && alive()) {
    // Bridge restarted and forgot the unit: spawn again and retry once (as dispatchOrder).
    runtime(u.id).spawned = false;
    if (!(await ensureSpawned(u))) return fail(`bridge unavailable at ${bridgeFor(u)}`, 502);
    if (!alive()) return fail("unit retired or reset running", 409);
    status = await sendToBridge(u, { text: body.text });
  }
  if (status < 200 || status >= 300) return fail(`bridge send failed (status ${status})`, 502);
  return { ok: true };
}

// No unit stands on a building (3 x 3 footprint around its tile, as the board draws it) or a zone wall (zone border).
function blockedTile(q: Pos): boolean {
  if (S().buildings.some((b) => Math.abs(b.x - q.x) <= 1 && Math.abs(b.y - q.y) <= 1)) return true;
  return S().components.some(({ zone: z }) =>
    q.x >= z.x && q.x < z.x + z.w && q.y >= z.y && q.y < z.y + z.h &&
    (q.x === z.x || q.x === z.x + z.w - 1 || q.y === z.y || q.y === z.y + z.h - 1));
}

// Nearest tile to p (p itself first) that is on the map, not blocked, and free of other units and targets.
function freeTileNear(p: Pos, self?: Unit): Pos {
  const taken = new Set([...S().units.filter((u) => u !== self).map((u) => u.pos), ...S().targets.map((t) => t.pos)].map((q) => `${q.x},${q.y}`));
  for (let ring = 0; ring <= 6; ring++)
    for (let dy = ring; dy >= -ring; dy--) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const q = { x: p.x + dx, y: p.y + dy };
      if (q.x >= 0 && q.y >= 0 && q.x < GRID && q.y < GRID && !taken.has(`${q.x},${q.y}`) && !blockedTile(q)) return q;
    }
  return { ...p };
}

// New units appear at the door (front row, +y) of their building: forged types at the Forge, builtins at the Barracks.
function spawnTile(forged: boolean): Pos {
  const kind = forged ? "river" : "barracks";
  const b = S().buildings.find((x) => x.kind === kind) ?? (forged ? { x: 3, y: 20 } : { x: 20, y: 20 });
  return freeTileNear({ x: b.x, y: Math.min(GRID - 1, b.y + 2) });
}

// Units left on a building or wall tile (old spawns, a changed world) step off to the nearest free tile.
function unblockUnits(announce: boolean): void {
  for (const u of S().units) {
    if (u.status === "moving" || !blockedTile(u.pos)) continue;
    u.pos = freeTileNear(u.pos, u);
    if (announce) emit("unit.moved", { unitId: u.id, pos: u.pos });
  }
}

function setTeam(u: Unit, team: number | null, changed: Set<Team>): void {
  if (u.team === team) return;
  for (const t of S().teams) {
    const i = t.members.indexOf(u.id);
    if (i >= 0 && t.id !== team) { t.members.splice(i, 1); dropWorkflowFor(t, u.id); changed.add(t); }
  }
  if (team !== null) {
    const t = teamById(team) ?? createTeam(team);
    if (!t.members.includes(u.id)) { t.members.push(u.id); changed.add(t); }
  }
  u.team = team;
  void patchOnBridge(u, team);
}

function createTeam(id: number): Team {
  const t: Team = { id, name: TEAM_NAMES[id - 1] ?? `Team ${id}`, color: TEAM_COLORS[id - 1] ?? "#888888", autopilot: false, members: [], workflow: null };
  S().teams.push(t);
  S().teams.sort((a, b) => a.id - b.id);
  return t;
}

const validTeamId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 9;

export function spawnUnit(body: any): Result {
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  const cls = String(body.class ?? "");
  const forged = CLASS_MODELS[cls] ? null : forgeType(cls);
  if (!CLASS_MODELS[cls] && !forged) return fail(`unknown class ${cls}`);
  if (forged && forged.status !== "ready") return fail(`type ${forged.name} is not ready (${forged.status})`);
  // Built-in classes run on BRIDGE_URL; forged types run on the Forge (bridgeFor routes by class).
  const c = CLASS_MODELS[cls] ?? { name: forged!.name, model: forged!.model ?? "forge", effort: "low" };
  if (body.team !== undefined && body.team !== null && !validTeamId(body.team)) return fail("team must be 1..9 or null");
  while (unitById(`u${nextUnit}`)) nextUnit++;
  const id = `u${nextUnit++}`;
  const u: Unit = {
    id, name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : `${c.name} ${id.slice(1)}`,
    class: cls, model: c.model, effort: c.effort, role: "worker", team: null, status: "idle",
    pos: spawnTile(!!forged), orderId: null, qm: { sessionId: null, sessionUrl: null }, loadout: defaultLoadout(),
  };
  S().units.push(u);
  const changed = new Set<Team>();
  if (validTeamId(body.team)) {
    const t = teamById(body.team) ?? createTeam(body.team);
    t.members.push(u.id);
    u.team = t.id;
    changed.add(t);
  }
  emit("unit.spawned", { unit: u });
  for (const t of changed) emit("team.updated", { team: t });
  void ensureSpawned(u);
  return { ok: true, unit: u };
}

export function retireUnit(id: string): Result {
  const u = unitById(id);
  if (!u) return fail("unknown unit", 404);
  cancelIfOpen(u.orderId ? orderById(u.orderId) : undefined);
  void deleteOnBridge(u);
  for (const t of S().teams) {
    const i = t.members.indexOf(u.id);
    if (i >= 0) { t.members.splice(i, 1); dropWorkflowFor(t, u.id); emit("team.updated", { team: t }); }
  }
  S().units.splice(S().units.indexOf(u), 1);
  const r = rt.get(u.id);
  if (r?.animTimer) clearTimeout(r.animTimer);
  rt.delete(u.id);
  emit("unit.retired", { unitId: u.id });
  return { ok: true };
}

export function patchUnit(id: string, body: any): Result {
  const u = unitById(id);
  if (!u) return fail("unknown unit", 404);
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  const changed = new Set<Team>();
  if (body.team !== undefined) {
    if (body.team !== null && !validTeamId(body.team)) return fail("team must be 1..9 or null");
    setTeam(u, body.team, changed);
  }
  if (typeof body.effort === "string") u.effort = body.effort;
  if (typeof body.role === "string") u.role = body.role;
  emit("unit.updated", { unit: u });
  for (const t of changed) emit("team.updated", { team: t });
  return { ok: true, unit: u };
}

export function assignTeam(body: any): Result {
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  if (!validTeamId(body.id)) return fail("id must be 1..9");
  if (!Array.isArray(body.members)) return fail("members must be an array");
  const members = [...new Set(body.members.filter((x: unknown) => typeof x === "string" && unitById(x)))] as string[];
  const team = teamById(body.id) ?? createTeam(body.id);
  const changed = new Set<Team>([team]);
  const changedUnits = new Set<Unit>();
  for (const uid of [...team.members]) if (!members.includes(uid)) {
    const u = unitById(uid)!;
    team.members.splice(team.members.indexOf(uid), 1);
    dropWorkflowFor(team, uid);
    u.team = null;
    void patchOnBridge(u, null);
    changedUnits.add(u);
  }
  for (const uid of members) {
    const u = unitById(uid)!;
    if (u.team !== team.id) { setTeam(u, team.id, changed); changedUnits.add(u); }
  }
  team.members = members;
  for (const u of changedUnits) emit("unit.updated", { unit: u });
  for (const t of changed) emit("team.updated", { team: t });
  return { ok: true, team };
}

export function patchTeam(id: number, body: any): Result {
  const t = teamById(id);
  if (!t) return fail("unknown team", 404);
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  if (typeof body.autopilot === "boolean") t.autopilot = body.autopilot;
  if (typeof body.name === "string" && body.name.trim()) t.name = body.name.trim().slice(0, 30);
  emit("team.updated", { team: t });
  return { ok: true, team: t };
}

// E14: brain /reset, fresh world, bridge sessions deleted and registered again, orders/teams/memory/stats cleared.
export async function resetWorld(): Promise<Result> {
  if (resetting) return fail("reset already running", 409);
  resetting = true;
  try {
    const old = S();
    const oldUnits = [...old.units];
    const forged = old.unitTypes.filter((t) => t.source === "forge");
    // Before the first await: drop every order and run of the old world (no cancel, so workflow.ts starts nothing).
    // A late reply, a workflow step, the tick or a pending dispatch then finds no live order and sends nothing.
    old.orders = [];
    old.workflowRuns = [];
    for (const u of oldUnits) u.orderId = null;
    for (const r of rt.values()) if (r.animTimer) clearTimeout(r.animTimer);
    rt.clear();
    history.clear();
    proposals.clear();
    briefs.clear();
    if (BRAIN_RESET) {
      const brain = await sendJson("POST", `${BRAIN_URL}/reset`, {}, 30000);
      if (brain.status !== 200) logOnce("brainreset", `brain /reset failed (status ${brain.status}); world reloads anyway`);
    }
    await Promise.all(oldUnits.map((u) => deleteOnBridge(u)));
    await loadWorld();
    S().unitTypes = [...S().unitTypes, ...forged];
    emit("state.snapshot", { state: S() });
  } finally {
    resetting = false;
  }
  for (const u of S().units) void ensureSpawned(u);
  void pollForge();
  void saveNow(); // the state file holds the fresh world at once
  return { ok: true };
}

// ---------- autopilot (E10, E11) ----------

function logVeto(o: Order, action: "cancel" | "adjust" | "go" | "expired", adjustedTo: { unitId?: string; targetId?: string } = {}): void {
  const p = proposals.get(o.id);
  if (!p) return;
  proposals.delete(o.id);
  const row = JSON.stringify({ ts: Date.now(), proposal: p.proposal, context: p.context, action, adjustedTo }) + "\n";
  // One write at a time so rows land in resolution order.
  vetoWrites = vetoWrites
    .then(() => mkdir(dirname(VETO_LOG), { recursive: true }))
    .then(() => appendFile(VETO_LOG, row))
    .catch((err) => logOnce("vetolog", `cannot write ${VETO_LOG}: ${err}`));
}
let vetoWrites: Promise<unknown> = Promise.resolve();

// Proposed -> active: the unit starts walking.
function activate(o: Order): void {
  const u = unitById(o.unitId);
  const t = targetById(o.targetId);
  if (!u || !t) return failOrder(o, "unit or target is gone");
  o.status = "active";
  u.orderId = o.id;
  u.status = "moving";
  runtime(u.id).dest = destFor(u, t);
  emit("order.updated", { order: o });
  emit("unit.updated", { unit: u });
  emit("unit.status", { unitId: u.id, status: u.status });
  refreshTarget(t);
}

function resolveProposal(o: Order, action: "go" | "expired"): void {
  if (o.status !== "proposed") return;
  logVeto(o, action);
  activate(o);
}

export function goOrder(id: string): Result {
  const o = orderById(id);
  if (!o) return fail("unknown order", 404);
  if (o.status !== "proposed") return fail(`order is ${o.status}, not proposed`);
  resolveProposal(o, "go");
  return { ok: true, order: o };
}

export function adjustOrder(id: string, body: any): Result {
  const o = orderById(id);
  if (!o) return fail("unknown order", 404);
  if (o.status !== "proposed") return fail(`order is ${o.status}, not proposed`);
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  const adjustedTo: { unitId?: string; targetId?: string } = {};
  if (body.targetId !== undefined) {
    const t = typeof body.targetId === "string" ? targetById(body.targetId) : undefined;
    if (!t) return fail("unknown targetId");
    if (t.status === "resolved") return fail("target already resolved");
    adjustedTo.targetId = t.id;
  }
  if (body.unitId !== undefined) {
    const u = typeof body.unitId === "string" ? unitById(body.unitId) : undefined;
    if (!u) return fail("unknown unitId");
    adjustedTo.unitId = u.id;
  }
  logVeto(o, "adjust", adjustedTo);
  if (adjustedTo.unitId && adjustedTo.unitId !== o.unitId) {
    releaseUnit(o);
    const nu = unitById(adjustedTo.unitId)!;
    cancelIfOpen(nu.orderId ? orderById(nu.orderId) : undefined);
    o.unitId = nu.id;
  }
  if (adjustedTo.targetId) o.targetId = adjustedTo.targetId;
  activate(o);
  return { ok: true, order: o };
}

let proposing = false;
async function autopilotTick(): Promise<void> {
  if (proposing || resetting) return;
  const teams = S().teams.filter((t) => t.autopilot && !t.workflow); // workflow teams are driven by their run
  if (!teams.length) return;
  const units = [...new Set(teams.flatMap((t) => t.members))].map(unitById).filter((u): u is Unit => !!u && u.status === "idle" && !u.orderId);
  if (!units.length) return;
  const taken = new Set(S().orders.filter((o) => o.status === "active" || o.status === "proposed").map((o) => o.targetId));
  const targets = S().targets.filter((t) => t.status !== "resolved" && !taken.has(t.id));
  if (!targets.length) return;
  const context: ProposeContext = {
    units: units.map((u) => ({ id: u.id, class: u.class, team: u.team, status: u.status, pos: u.pos, history: history.get(u.id) ?? [] })),
    targets: targets.map((t) => ({ id: t.id, component: t.component, severity: t.severity, kind: t.kind, status: t.status, pos: t.pos, customers: t.customers })),
    memory: S().memory.recent.slice(-5).map((m) => m.summary).join("\n"),
  };
  proposing = true;
  try {
    const res = await sendJson<{ proposals?: Proposal[] }>("POST", `${PROPOSER_URL}/propose`, context, 8000);
    if (res.status !== 200 || !Array.isArray(res.data?.proposals)) {
      logOnce("proposer", `proposer unavailable at ${PROPOSER_URL} (status ${res.status})`);
      return;
    }
    // Re-check against the live world: orders may have been given (or a reset started) while the proposer was thinking.
    if (resetting) return;
    const busy = new Set(S().orders.filter((o) => o.status === "active" || o.status === "proposed").map((o) => o.targetId));
    for (const p of res.data!.proposals!) {
      const u = p && typeof p.unitId === "string" ? unitById(p.unitId) : undefined;
      const t = p && typeof p.targetId === "string" ? targetById(p.targetId) : undefined;
      if (!u || !t || u.status !== "idle" || u.orderId || !units.includes(u) || busy.has(t.id) || t.status !== "open") continue;
      if (!S().teams.some((tm) => tm.autopilot && !tm.workflow && tm.members.includes(u.id))) continue;
      busy.add(t.id);
      const o: Order = { id: `o${nextOrder++}`, unitId: u.id, targetId: t.id, status: "proposed", source: "autopilot", vetoDeadline: Date.now() + VETO_WINDOW_MS, reply: null };
      S().orders.push(o);
      proposals.set(o.id, { proposal: { unitId: u.id, targetId: t.id, reason: String(p.reason ?? "") }, context });
      u.orderId = o.id;
      u.status = "waiting_approval";
      emit("order.proposed", { order: o });
      emit("unit.updated", { unit: u });
      emit("unit.status", { unitId: u.id, status: u.status });
    }
  } finally {
    proposing = false;
  }
}

// ---------- startup ----------

// ---------- E18: save and restore (src/persist.ts writes the file) ----------

type SavedRuntime = Pick<Runtime, "sentOrderId" | "learningSlug" | "gbrainCalls" | "gbrainReads" | "gbrainWrites">;
export interface GameSave {
  backend: string; state: State; nextOrder: number; nextUnit: number; customers: Customer[];
  briefs: [string, NodeBrief][]; proposals: [string, { proposal: Proposal; context: ProposeContext }][];
  history: [string, { targetId: string; component: string }[]][]; runtime: Record<string, SavedRuntime>; flow: unknown;
}

// Everything a restart needs; null while a reset runs (the half-cleared world is never saved).
export function gameSnapshot(): GameSave | null {
  if (resetting) return null;
  const runtime: Record<string, SavedRuntime> = {};
  for (const [id, r] of rt) runtime[id] = { sentOrderId: r.sentOrderId, learningSlug: r.learningSlug, gbrainCalls: r.gbrainCalls, gbrainReads: r.gbrainReads, gbrainWrites: r.gbrainWrites };
  let flowRuns: unknown = null;
  try { flowRuns = flow.saveRuns?.() ?? null; } catch (err) { logOnce("flowsave", `workflow saveRuns failed: ${err}`); }
  return {
    backend: backendName(), state: S(), nextOrder, nextUnit, customers: [...customers.values()],
    briefs: [...briefs], proposals: [...proposals], history: [...history], runtime, flow: flowRuns,
  };
}

// Puts a saved game back. Active orders stay active: a unit that had not reached its target walks on and sends on
// arrival; a unit whose order was sent keeps working and the bridge delivers the reply with the same orderId.
// Proposed orders get a fresh veto window. Returns false (nothing changed) when the save is unusable.
export function restoreGame(g: GameSave): boolean {
  const st = g?.state;
  if (!st || !Array.isArray(st.units) || !Array.isArray(st.orders) || !Array.isArray(st.targets) || !Array.isArray(st.components) || !st.components.length) return false;
  st.backend = backendName();
  st.workflowRuns ??= [];
  store.state = st;
  for (const r of rt.values()) if (r.animTimer) clearTimeout(r.animTimer);
  rt.clear();
  briefs.clear();
  proposals.clear();
  history.clear();
  customers = new Map((g.customers ?? []).map((c) => [c.id, c]));
  for (const [k, v] of g.briefs ?? []) briefs.set(k, v);
  for (const [k, v] of g.proposals ?? []) proposals.set(k, v);
  for (const [k, v] of g.history ?? []) history.set(k, v);
  const num = (id: string) => Number(id.slice(1)) || 0;
  nextOrder = Math.max(nextOrder, g.nextOrder ?? 1, ...st.orders.map((o) => num(o.id) + 1));
  nextUnit = Math.max(g.nextUnit ?? 1, ...st.units.map((u) => num(u.id) + 1));
  const now = Date.now();
  for (const u of st.units) {
    u.loadout ??= defaultLoadout();
    const r = runtime(u.id);
    Object.assign(r, g.runtime?.[u.id] ?? {});
    const o = u.orderId ? orderById(u.orderId) : undefined;
    const t = o ? targetById(o.targetId) : undefined;
    if (!o || !t || o.unitId !== u.id || (o.status !== "active" && o.status !== "proposed")) {
      u.orderId = null;
      u.status = "idle";
    } else if (o.status === "proposed") {
      o.vetoDeadline = now + VETO_WINDOW_MS;
      u.status = "waiting_approval";
    } else if (r.sentOrderId === o.id) {
      u.status = "working";
    } else {
      u.status = "moving";
      r.dest = destFor(u, t);
    }
  }
  // An open order whose unit no longer holds it cannot finish: close it quietly (no clients are connected yet).
  for (const o of st.orders) {
    if ((o.status === "active" || o.status === "proposed") && unitById(o.unitId)?.orderId !== o.id) { o.status = "cancelled"; proposals.delete(o.id); }
  }
  for (const t of st.targets) if (t.status === "engaged" && !st.orders.some((o) => o.targetId === t.id && o.status === "active")) t.status = "open";
  unblockUnits(false);
  if (flow.loadRuns) {
    try { flow.loadRuns(g.flow); } catch (err) { console.error("[engine] workflow loadRuns failed:", err); }
  } else {
    // Without the runner's own data a running run cannot take its next edge: end it; its open step finishes as is.
    for (const run of st.workflowRuns) if (run.status === "running") run.status = "failed";
  }
  return true;
}

export async function startGame(): Promise<void> {
  const saved = readSaved<GameSave>();
  if (saved && saved.game.backend !== backendName()) console.log(`[engine] ${STATE_FILE} is for backend ${saved.game.backend}, not ${backendName()}; starting fresh`);
  if (saved && saved.game.backend === backendName() && restoreGame(saved.game)) {
    const open = S().orders.filter((o) => o.status === "active" || o.status === "proposed").length;
    console.log(`[engine] restored the game from ${STATE_FILE} (saved ${Math.round((Date.now() - saved.savedAt) / 1000)} s ago, ${S().orders.length} orders, ${open} open)`);
    void refreshPages();
  } else {
    await loadWorld();
  }
  startSaving(gameSnapshot);
  setInterval(tick, Math.round(1000 / TILES_PER_SEC));
  setInterval(() => void autopilotTick(), AUTOPILOT_EVERY_MS);
  setInterval(() => void refreshPages(), 10000);
  startForge();
  const bridges = new Set<string>([BRIDGE_URL, FORGE_URL]);
  for (const base of bridges) {
    followBridgeEvents(base, onBridgeEvent, () => resyncUnits(base));
  }
}

export { fixtureUnits, autopilotTick, tick, resyncUnits };
