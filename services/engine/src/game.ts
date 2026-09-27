// Game rules: world loading, orders, movement, teams, and mapping bridge events to engine events.
import type { BridgeEvent, Customer, MemoryOp, Order, Pos, Target, Team, Unit, World } from "../../../contract/types.ts";
import { BRAIN_URL, BRIDGE_URL, CLASS_MODELS, GRID, MEMORY_ANIM_MS, MEMORY_RECENT_MAX, TILES_PER_SEC } from "./config.ts";
import { fixtureState, fixtureUnits } from "./fixture.ts";
import { emit, store } from "./store.ts";
import { getJson, logOnce, sendJson } from "./http.ts";
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
let nextOrder = 1;
let nextUnit = 1;
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
      ...t, issue: String(t.issue), status: t.status ?? "open", customers: Array.isArray(t.customers) ? t.customers : [],
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
  nextOrder = 1;
}

// ---------- bridge ----------

async function ensureSpawned(u: Unit): Promise<boolean> {
  const r = runtime(u.id);
  if (r.spawned) return true;
  if (!r.spawning) {
    r.spawning = (async () => {
      const res = await spawnOnBridge(u);
      if (!res) return false;
      r.spawned = true;
      const live = unitById(u.id);
      if (live) {
        live.qm = { sessionId: res.sessionId, sessionUrl: res.sessionUrl };
        emit("unit.updated", { unit: live });
      }
      return true;
    })().finally(() => { r.spawning = null; });
  }
  return r.spawning;
}

function orderPrompt(u: Unit, o: Order, t: Target, learningSlug: string): string {
  const issue = t.issue.toLowerCase();
  const pages = [`components/${t.component}`, `issues/${issue}`, ...t.customers.map((c) => `companies/${c}`)];
  return [
    `Order ${o.id}: work on issue ${t.issue} "${t.title}" (${t.kind}, severity ${t.severity}).`,
    `Component: ${t.component}`,
    `Customers: ${t.customers.join(", ")}`,
    `GBrain pages: ${pages.join(", ")}`,
    `Lumen is a synthetic product with no code checkout; GBrain is your only source. 1) Recall first: read the pages above and search GBrain for house rules and past learnings on this component. 2) Decide the fix and say it in 3 to 5 sentences, naming any rule you applied. 3) Remember: write one GBrain page ${learningSlug} (type learning) with what you learned, linking [[components/${t.component}]] and [[issues/${issue}]]. Reply in at most 4 sentences.`,
  ].join("\n");
}

async function dispatchOrder(u: Unit, o: Order): Promise<void> {
  const t = targetById(o.targetId);
  if (!t) return failOrder(o, "target vanished");
  const r = runtime(u.id);
  r.sentOrderId = o.id;
  r.gbrainCalls = 0;
  r.gbrainReads = 0;
  r.gbrainWrites = 0;
  r.learningSlug = `learnings/${t.issue.toLowerCase()}-${u.id}-${Date.now()}`;
  const req = { text: orderPrompt(u, o, t, r.learningSlug), orderId: o.id, targetId: t.id, componentId: t.component };
  if (!(await ensureSpawned(u))) return failOrder(o, `bridge unavailable at ${bridgeFor(u)}`);
  let status = await sendToBridge(u, req);
  if (status === 404) {
    // Bridge restarted and forgot the unit: spawn again and retry once.
    r.spawned = false;
    if (await ensureSpawned(u)) status = await sendToBridge(u, req);
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
}

function completeOrder(o: Order, reply: string): void {
  if (o.status !== "active") return;
  const r = runtime(o.unitId);
  const used = { reads: r.gbrainReads, writes: r.gbrainWrites };
  o.status = "done";
  o.reply = reply;
  emit("order.updated", { order: o });
  releaseUnit(o);
  refreshTarget(targetById(o.targetId), true);
  void brainFallback(o, reply, used);
}

// E7: when the agent made no gbrain read (or write) call for this order, the engine does it through the brain service.
async function brainFallback(o: Order, reply: string, used: { reads: number; writes: number }): Promise<void> {
  const t = targetById(o.targetId);
  if (!t) return;
  if (used.reads === 0) {
    const res = await sendJson<{ slugs?: string[]; context?: string }>("POST", `${BRAIN_URL}/recall`, { componentId: t.component, targetId: t.id, unitId: o.unitId });
    if (res.status === 200 && res.data) {
      const slugs = Array.isArray(res.data.slugs) ? res.data.slugs.filter((x) => typeof x === "string") : [];
      const summary = `Recalled ${slugs.length} pages for ${t.issue} (engine fallback)`;
      pushMemory({ ts: Date.now(), unitId: o.unitId, op: "recall", slugs, summary });
      emit("memory.recall", { unitId: o.unitId, slugs, summary });
    } else logOnce("fallback:recall", `brain /recall fallback failed (status ${res.status})`);
  }
  if (used.writes === 0 && reply.trim()) {
    const res = await sendJson<{ slug?: string }>("POST", `${BRAIN_URL}/remember`, { unitId: o.unitId, targetId: t.id, text: reply });
    if (res.status === 200 && res.data && typeof res.data.slug === "string") {
      const summary = `Remembered the outcome of ${t.issue} (engine fallback)`;
      pushMemory({ ts: Date.now(), unitId: o.unitId, op: "remember", slugs: [res.data.slug], summary });
      emit("memory.remember", { unitId: o.unitId, slug: res.data.slug, summary });
      void refreshPages();
    } else logOnce("fallback:remember", `brain /remember fallback failed (status ${res.status})`);
  }
}

function failOrder(o: Order, reason: string): void {
  if (o.status !== "active" && o.status !== "proposed") return;
  o.status = "failed";
  o.reply = reason;
  emit("unit.activity", { unitId: o.unitId, orderId: o.id, kind: "error", text: reason });
  emit("order.updated", { order: o });
  releaseUnit(o);
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

function slugsFrom(args: any): string[] {
  const s = argStrings(args, ["slugs", "slug", "page", "from", "to"]);
  if (s.length) return [...new Set(s)];
  const q = argStrings(args, ["query", "q"])[0] ?? "";
  return [...new Set(q.match(/[a-z]+\/[a-z0-9][a-z0-9._-]*/gi) ?? [])];
}

function handleGbrainTool(u: Unit, tool: string, args: any, text: string, orderId: string | undefined): void {
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
    void refreshPages();
  } else {
    r.gbrainReads++;
    const slugs = slugsFrom(args);
    const summary = text || argStrings(args, ["query", "q"])[0] || slugs.join(", ");
    pushMemory({ ts: Date.now(), unitId: u.id, op: "recall", slugs, summary });
    emit("memory.recall", { unitId: u.id, slugs, summary });
    memoryAnim(u, "recalling", orderId);
  }
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
      if (p.x < 0 || p.y < 0 || p.x >= GRID || p.y >= GRID || taken.has(`${p.x},${p.y}`)) continue;
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
  o.status = "cancelled";
  emit("order.updated", { order: o });
  releaseUnit(o);
  refreshTarget(targetById(o.targetId));
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
  cancelIfOpen(o);
  return { ok: true, order: o };
}

export async function messageUnit(id: string, body: any): Promise<Result> {
  const u = unitById(id);
  if (!u) return fail("unknown unit", 404);
  if (!body || typeof body.text !== "string" || !body.text.trim()) return fail("text required");
  if (!(await ensureSpawned(u))) return fail(`bridge unavailable at ${bridgeFor(u)}`, 502);
  const status = await sendToBridge(u, { text: body.text });
  if (status < 200 || status >= 300) return fail(`bridge send failed (status ${status})`, 502);
  return { ok: true };
}

function freeTileNear(p: Pos): Pos {
  const taken = new Set(S().units.map((u) => `${u.pos.x},${u.pos.y}`));
  for (let ring = 1; ring <= 4; ring++)
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (q.x >= 0 && q.y >= 0 && q.x < GRID && q.y < GRID && !taken.has(`${q.x},${q.y}`)) return q;
    }
  return { ...p };
}

function setTeam(u: Unit, team: number | null, changed: Set<Team>): void {
  if (u.team === team) return;
  for (const t of S().teams) {
    const i = t.members.indexOf(u.id);
    if (i >= 0 && t.id !== team) { t.members.splice(i, 1); changed.add(t); }
  }
  if (team !== null) {
    const t = teamById(team) ?? createTeam(team);
    if (!t.members.includes(u.id)) { t.members.push(u.id); changed.add(t); }
  }
  u.team = team;
  void patchOnBridge(u, team);
}

function createTeam(id: number): Team {
  const t: Team = { id, name: TEAM_NAMES[id - 1] ?? `Team ${id}`, color: TEAM_COLORS[id - 1] ?? "#888888", autopilot: false, members: [] };
  S().teams.push(t);
  S().teams.sort((a, b) => a.id - b.id);
  return t;
}

const validTeamId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 9;

export function spawnUnit(body: any): Result {
  if (!body || typeof body !== "object") return fail("body must be a JSON object");
  const cls = String(body.class ?? "");
  const c = CLASS_MODELS[cls];
  if (!c) return fail(`unknown class ${cls}`);
  if (body.team !== undefined && body.team !== null && !validTeamId(body.team)) return fail("team must be 1..9 or null");
  while (unitById(`u${nextUnit}`)) nextUnit++;
  const id = `u${nextUnit++}`;
  const barracks = S().buildings.find((b) => b.kind === "barracks") ?? { x: 20, y: 20 };
  const u: Unit = {
    id, name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : `${c.name} ${id.slice(1)}`,
    class: cls, model: c.model, effort: c.effort, role: "worker", team: null, status: "idle",
    pos: freeTileNear({ x: barracks.x, y: barracks.y }), orderId: null, qm: { sessionId: null, sessionUrl: null },
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
    if (i >= 0) { t.members.splice(i, 1); emit("team.updated", { team: t }); }
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

export async function resetWorld(): Promise<Result> {
  const sessions = new Map(S().units.map((u) => [u.id, u.qm]));
  for (const r of rt.values()) { if (r.animTimer) clearTimeout(r.animTimer); r.dest = null; r.sentOrderId = null; }
  await loadWorld();
  // Keep bridge sessions for units that survive the reset.
  for (const u of S().units) {
    const qm = sessions.get(u.id);
    if (qm && runtime(u.id).spawned) u.qm = qm;
  }
  emit("state.snapshot", { state: S() });
  return { ok: true };
}

// ---------- startup ----------

export async function startGame(): Promise<void> {
  await loadWorld();
  setInterval(tick, Math.round(1000 / TILES_PER_SEC));
  const bridges = new Set<string>([BRIDGE_URL]);
  for (const base of bridges) {
    followBridgeEvents(base, onBridgeEvent, () => {
      for (const u of S().units) if (bridgeFor(u) === base) void ensureSpawned(u);
    });
  }
}

export { fixtureUnits };
