// Autopilot soak on the TEST engine (4618, mock backend), owner raid-eng-mock. Never point it at 4610 (real QM).
//   bun test/soak.ts [minutes, default 3] [--seed N] [--no-reset] [--shared]
// Turns autopilot on for every team and answers each proposal at random (go / cancel / adjust / let expire).
// POST /api/reset at the start and whenever every target is resolved (4618 has BRAIN_RESET=0: engine state only).
// Asserts: engine healthy; no unit non-idle without an active or proposed order for > 30 s; no active order whose unit
// idles for > 30 s or that runs > 90 s; no proposed order lingering > 3 s past its deadline; when a proposal is created
// no other active or proposed order holds its target (engine invariant); no target in two active orders (holds here
// because the soak never sends team orders or adjusts onto a held target); SSE seq strictly increasing; every
// resolution appears in the test veto log exactly once: an extra row (duplicate or unexplained) is a violation, since
// the soak runs under the exclusive 4618 lock; --shared (other clients may veto on the same engine) only reports extras.
// The test engine runs under bun --watch: a restart (SSE reconnect) starts
// seq and order ids over and drops open proposals, so it is handled like a reset and reported, not failed.
// Env: ENGINE_URL (http://127.0.0.1:4618), VETO_LOG (/tmp/engplan/vetoes-test.jsonl).
const E = (process.env.ENGINE_URL ?? "http://127.0.0.1:4618").replace(/\/$/, "");
const VETO_LOG = process.env.VETO_LOG ?? "/tmp/engplan/vetoes-test.jsonl";
if (new URL(E).port === "4610") { console.error("refusing to run against 4610 (the real QM engine); use the test engine on 4618"); process.exit(2); }
const argv = process.argv.slice(2);
const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const MINUTES = Number(argv.find((a) => /^\d+(\.\d+)?$/.test(a) && argv[argv.indexOf(a) - 1] !== "--seed") ?? 3);
const SEED = Number(opt("--seed") ?? Date.now() % 100000);
const RESET = !argv.includes("--no-reset");
const SHARED = argv.includes("--shared");

// seeded PRNG (mulberry32) so a failing run can be replayed with --seed
let seedState = SEED >>> 0;
const rand = () => { seedState = (seedState + 0x6d2b79f5) >>> 0; let t = seedState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;

const H = { "content-type": "application/json" };
async function call(url: string, method = "GET", body?: unknown): Promise<{ s: number; d: any }> {
  try {
    const r = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000) });
    return { s: r.status, d: await r.json().catch(() => null) };
  } catch { return { s: 0, d: null }; }
}

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const violations: string[] = [];
const violate = (msg: string) => { violations.push(`[${secs()}s] ${msg}`); if (violations.length <= 30) console.log(`VIOLATION [${secs()}s] ${msg}`); };

// ---- SSE: seq order, order tracking, proposal invariant ----
type Order = { id: string; unitId: string; targetId: string; status: string; source: string; vetoDeadline: number | null };
const orders = new Map<string, Order>();
let lastSeq = -1, snapshots = 0, eventsSeen = 0, epoch = 0, mapEpoch = 0, freshConn = false, restarts = 0;
const proposalQueue: Order[] = [];
const ctl = new AbortController();
function onEvent(e: any) {
  eventsSeen++;
  if (freshConn && e.type === "state.snapshot") {
    freshConn = false;
    if (lastSeq >= 0 && e.seq < lastSeq) { console.log(`[${secs()}s] engine restarted (seq ${e.seq} after ${lastSeq}); handled like a reset`); epoch++; restarts++; lastSeq = -1; }
  }
  if (typeof e.seq === "number") {
    if (e.type === "state.snapshot" ? e.seq < lastSeq : e.seq <= lastSeq) violate(`SSE seq not increasing: ${e.type} seq ${e.seq} after ${lastSeq}`);
    lastSeq = Math.max(lastSeq, e.seq);
  }
  if (e.type === "state.snapshot") {
    snapshots++;
    // proposals still open when a reset or restart hits are cleared without a veto row
    for (const p of pending.values()) if (p.expect !== "dropped" && p.epoch === mapEpoch && orders.get(p.order.id)?.status === "proposed") p.expect = "dropped";
    orders.clear();
    for (const o of e.state?.orders ?? []) orders.set(o.id, o);
    for (const p of pending.values()) if (p.expect === "pending" && p.epoch === mapEpoch) p.expect = "dropped"; // answer still in flight
    mapEpoch = epoch;
  } else if (e.type === "order.proposed") {
    const o: Order = e.order;
    const holder = [...orders.values()].find((x) => x.id !== o.id && x.targetId === o.targetId && (x.status === "active" || x.status === "proposed"));
    if (holder) violate(`proposal ${o.id} for ${o.targetId} while ${holder.id} is ${holder.status} on it`);
    orders.set(o.id, o);
    proposalQueue.push(o);
  } else if (e.type === "order.updated") {
    orders.set(e.order.id, e.order);
  }
}
async function listen(): Promise<void> {
  while (!ctl.signal.aborted) {
    try {
      const r = await fetch(`${E}/api/events`, { signal: ctl.signal });
      freshConn = true;
      const rd = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of blk.split("\n")) if (line.startsWith("data:")) { try { onEvent(JSON.parse(line.slice(5).trim())); } catch {} }
        }
      }
      if (!ctl.signal.aborted) console.log(`[${secs()}s] SSE stream ended; reconnecting`);
    } catch { if (!ctl.signal.aborted) console.log(`[${secs()}s] SSE connection failed; retrying`); }
    if (!ctl.signal.aborted) await Bun.sleep(1000);
  }
}

// ---- proposals: random answers and the veto rows they must produce ----
type Action = "go" | "cancel" | "adjust" | "expire";
type Pending = { order: Order; action: Action; epoch: number; expect: "go" | "cancel" | "adjust" | "expired" | "any" | "pending" | "dropped" };
const pending = new Map<string, Pending>();
const counts: Record<string, number> = { proposals: 0, go: 0, cancel: 0, adjust: 0, expire: 0, raced: 0, resets: 0 };
let state: any = null;

function freeTargets(except: string): string[] {
  if (!state) return [];
  const held = new Set([...orders.values()].filter((o) => o.status === "active" || o.status === "proposed").map((o) => o.targetId));
  return state.targets.filter((t: any) => t.status === "open" && !held.has(t.id) && t.id !== except).map((t: any) => t.id);
}

async function answer(o: Order) {
  const r = rand();
  let action: Action = r < 0.3 ? "go" : r < 0.6 ? "cancel" : r < 0.8 ? "adjust" : "expire";
  const p: Pending = { order: { ...o }, action, epoch, expect: "pending" };
  pending.set(`${epoch}:${o.id}`, p); // order ids start over after an engine restart
  counts.proposals++;
  if (action === "expire") { counts.expire++; p.expect = "expired"; return; }
  await Bun.sleep(300 + rand() * 3700);
  if (p.expect === "dropped") return;
  let res;
  if (action === "adjust") {
    const free = freeTargets(o.targetId);
    if (!free.length) action = p.action = "go";
    else res = await call(`${E}/api/orders/${o.id}/adjust`, "POST", { targetId: pick(free) });
  }
  if (!res) res = await call(`${E}/api/orders/${o.id}/${action}`, "POST", {});
  if (p.expect === "dropped") return;
  if (res.d?.ok === true) { counts[action]++; p.expect = action as Pending["expect"]; }
  else { counts.raced++; p.expect = "any"; } // lost a race (expired or reset first): some row must still exist unless reset dropped it
}

// ---- per-second invariants from GET /api/state ----
const since = new Map<string, number>();    // key -> first seen ms
const reported = new Set<string>();
function hold(key: string, bad: boolean, limitMs: number, msg: () => string) {
  if (!bad) { since.delete(key); reported.delete(key); return; }
  const first = since.get(key) ?? Date.now();
  since.set(key, first);
  if (Date.now() - first > limitMs && !reported.has(key)) { reported.add(key); violate(msg()); }
}
let healthFails = 0, resetting = false;
async function checkOnce() {
  const h = await call(`${E}/health`);
  if (h.d?.ok !== true) { if (++healthFails === 3) violate("engine /health failed 3 times in a row"); return; }
  healthFails = 0;
  const st = (await call(`${E}/api/state`)).d;
  if (!st) return;
  state = st;
  const byId = new Map<string, any>(st.orders.map((o: any) => [o.id, o]));
  for (const u of st.units) {
    const o = u.orderId ? byId.get(u.orderId) : null;
    const hasOrder = !!o && (o.status === "active" || o.status === "proposed");
    hold(`stuck:${u.id}`, u.status !== "idle" && !hasOrder, 30000, () => `unit ${u.id} is ${u.status} without an active or proposed order for > 30 s`);
  }
  const activeByTarget = new Map<string, string[]>();
  for (const o of st.orders) {
    if (o.status === "active") {
      activeByTarget.set(o.targetId, [...(activeByTarget.get(o.targetId) ?? []), o.id]);
      const u = st.units.find((x: any) => x.id === o.unitId);
      hold(`idle-active:${o.id}`, !!u && u.status === "idle", 30000, () => `active order ${o.id} but unit ${o.unitId} idles for > 30 s`);
      hold(`long:${o.id}`, true, 90000, () => `order ${o.id} active for > 90 s`);
    } else { hold(`idle-active:${o.id}`, false, 0, () => ""); hold(`long:${o.id}`, false, 0, () => ""); }
    if (o.status === "proposed" && typeof o.vetoDeadline === "number" && Date.now() > o.vetoDeadline + 3000 && !reported.has(`late:${o.id}`)) {
      reported.add(`late:${o.id}`); violate(`proposal ${o.id} still proposed ${((Date.now() - o.vetoDeadline) / 1000).toFixed(1)} s after its deadline`);
    }
  }
  for (const [t, ids] of activeByTarget) if (ids.length > 1 && !reported.has(`dup:${ids.join(",")}`)) { reported.add(`dup:${ids.join(",")}`); violate(`target ${t} in ${ids.length} active orders: ${ids.join(", ")}`); }

  // keep the soak busy: once every target is resolved and nothing is running, reset the world
  if (RESET && !resetting && st.targets.every((t: any) => t.status === "resolved") && !st.orders.some((o: any) => o.status === "active" || o.status === "proposed")) {
    resetting = true;
    await resetWorld();
    resetting = false;
  }
}

async function autopilotAll(on: boolean) {
  const st = (await call(`${E}/api/state`)).d;
  for (const t of st?.teams ?? []) if (t.members.length) await call(`${E}/api/teams/${t.id}`, "PATCH", { autopilot: on });
}
async function resetWorld() {
  const r = await call(`${E}/api/reset`, "POST", {});
  if (r.d?.ok !== true) { violate(`POST /api/reset failed: ${JSON.stringify(r.d)}`); return; }
  counts.resets++;
  console.log(`[${secs()}s] reset #${counts.resets}`);
  await Bun.sleep(1000);
  await autopilotAll(true); // reset turns autopilot off
}

async function vetoRows(): Promise<any[]> {
  const txt = await Bun.file(VETO_LOG).text().catch(() => "");
  return txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---- run ----
console.log(`soak on ${E} for ${MINUTES} min, seed ${SEED}, reset ${RESET ? "on" : "off"}`);
const h0 = await call(`${E}/health`);
if (h0.d?.ok !== true) { console.error(`engine not healthy at ${E}`); process.exit(1); }
const rowsBefore = (await vetoRows()).length;
const teamsBefore: Array<{ id: number; autopilot: boolean }> = ((await call(`${E}/api/state`)).d?.teams ?? []).map((t: any) => ({ id: t.id, autopilot: t.autopilot }));
void listen();
await Bun.sleep(800);
if (RESET) await resetWorld(); else await autopilotAll(true);

const end = t0 + MINUTES * 60000;
let lastReport = Date.now();
while (Date.now() < end) {
  while (proposalQueue.length) void answer(proposalQueue.shift()!);
  await checkOnce();
  if (Date.now() - lastReport > 30000) {
    lastReport = Date.now();
    console.log(`[${secs()}s] events ${eventsSeen}, proposals ${counts.proposals}, go ${counts.go}, cancel ${counts.cancel}, adjust ${counts.adjust}, expire ${counts.expire}, raced ${counts.raced}, resets ${counts.resets}, violations ${violations.length}`);
  }
  await Bun.sleep(1000);
}

// wind down: autopilot off, let open proposals expire, then match the veto log
await autopilotAll(false);
const drainEnd = Date.now() + 20000;
while (Date.now() < drainEnd) {
  while (proposalQueue.length) void answer(proposalQueue.shift()!);
  const st = (await call(`${E}/api/state`)).d;
  const openProposals = st?.orders?.filter((o: any) => o.status === "proposed").length ?? 0;
  const inFlight = [...pending.values()].some((p) => p.expect === "pending");
  if (!openProposals && !inFlight) break;
  await Bun.sleep(1000);
}
await Bun.sleep(1500); // veto rows are appended asynchronously
for (const t of teamsBefore) await call(`${E}/api/teams/${t.id}`, "PATCH", { autopilot: t.autopilot });
ctl.abort();

const rows = (await vetoRows()).slice(rowsBefore);
const pool = new Map<string, number>();
const key = (u: string, t: string, a: string) => `${u}|${t}|${a}`;
for (const r of rows) pool.set(key(r.proposal?.unitId, r.proposal?.targetId, r.action), (pool.get(key(r.proposal?.unitId, r.proposal?.targetId, r.action)) ?? 0) + 1);
const take = (k: string) => { const n = pool.get(k) ?? 0; if (n > 0) { pool.set(k, n - 1); return true; } return false; };
let matched = 0;
const exact = [...pending.values()].filter((p) => ["go", "cancel", "adjust", "expired"].includes(p.expect));
for (const p of exact) { if (take(key(p.order.unitId, p.order.targetId, p.expect))) matched++; else violate(`no veto row for ${p.order.id} ${p.order.unitId}->${p.order.targetId} action ${p.expect}`); }
for (const p of [...pending.values()].filter((p) => p.expect === "any")) {
  const a = ["expired", "cancel", "go", "adjust"].find((act) => take(key(p.order.unitId, p.order.targetId, act)));
  if (a) matched++; else violate(`no veto row for ${p.order.id} ${p.order.unitId}->${p.order.targetId} (lost race)`);
}
for (const p of [...pending.values()].filter((p) => p.expect === "pending")) violate(`proposal ${p.order.id} never resolved`);
const dropped = [...pending.values()].filter((p) => p.expect === "dropped").length;
const extra = [...pool.values()].reduce((a, b) => a + b, 0);
if (extra && !SHARED) for (const [k, n] of pool) if (n > 0) violate(`${n} extra veto row(s) for ${k} (unit|target|action): duplicate or unexplained resolution`);

console.log(`\nsoak ${MINUTES} min, seed ${SEED}: events ${eventsSeen}, snapshots ${snapshots}, restarts ${restarts}, proposals ${counts.proposals} (go ${counts.go}, cancel ${counts.cancel}, adjust ${counts.adjust}, expire ${counts.expire}, raced ${counts.raced}, dropped by reset ${dropped}), resets ${counts.resets}`);
console.log(`veto log: ${rows.length} new rows, ${matched} matched${extra ? `, ${extra} extra${SHARED ? " (--shared: reported only)" : " (violation)"}` : ""}`);
if (violations.length) { console.log(`\n${violations.length} violation(s):`); for (const v of violations.slice(0, 40)) console.log(`  ${v}`); }
console.log(violations.length ? "\nsoak: FAIL" : "\nsoak: PASS");
process.exit(violations.length ? 1 : 0);
