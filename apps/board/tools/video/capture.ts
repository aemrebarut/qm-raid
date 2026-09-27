// Video capture (raid-video-cap): one raw 1920x1080 clip per capability, recorded as a CDP screencast (mp4),
// driven by real mouse clicks on the board (camps and units are projected from window.raidScene), plus a markers
// JSON per clip with event times (ms from the first video frame) from the engine SSE and from our own actions,
// so the editor (raid-video, Remotion) can cut and speed-ramp.
// Usage: bun apps/board/tools/video/capture.ts --take dry1 [--url 'http://127.0.0.1:4619/?art=on'] [--only orders,teams]
//        [--out ~/Workspace/qm-raid-video/clips] [--forge-submit] [--parallel] [--debug] [--keep-frames]
//        [--ranger forge-refund-ranger-2] [--reviewer forge-rule-warden] [--loadout-wait 150000]
// Output (raid-video's contract): <out>/<id>.mp4 and <out>/<id>.markers.json = {clip, events: [{t: seconds from clip
// start, name, x?, y?}]} (x, y screen px when known), ids orders, teams, forge, autopilot, loadout; a copy of each
// take also goes to ~/Workspace/qm-raid-video/<take>/clips.
// Dry runs on the test board 4619 (mock engine 4618); takes on the frozen demo board 4621 (real engine 4610).
// Never 4611 (Emre's live board). Writes only outside the repo. Prints the browser PID so only it gets stopped.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const has = (name: string) => argv.includes(`--${name}`);
const url = flag("url", "http://127.0.0.1:4619/?art=on");
if (/:4611\b/.test(url)) {
  console.error("capture: refusing to run against the live board on 4611");
  process.exit(2);
}
const origin = new URL(url).origin;
const take = flag("take", "dry");
const outDir = resolve(flag("out", join(homedir(), "Workspace/qm-raid-video/clips")).replace(/^~/, homedir()));
const archiveDir = join(homedir(), "Workspace/qm-raid-video", take, "clips");
const only = flag("only", "").split(",").filter(Boolean);
const forgeSubmit = has("forge-submit"); // real River training on 4610: only with raid-river's go
const W = 1920, H = 1080;
mkdirSync(outDir, { recursive: true });
mkdirSync(archiveDir, { recursive: true });

function findPlaywright(): string {
  if (process.env.PLAYWRIGHT_DIR) return process.env.PLAYWRIGHT_DIR;
  const npx = join(homedir(), ".npm/_npx");
  const hits: { dir: string; v: number[] }[] = [];
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const dir = join(npx, d, "node_modules/playwright");
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) hits.push({ dir, v: String(require(pkg).version).split(".").map(Number) });
  }
  hits.sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1] || b.v[2] - a.v[2]);
  if (!hits[0]) throw new Error("playwright not found: run `npx playwright --version` once or set PLAYWRIGHT_DIR");
  return hits[0].dir;
}
const { chromium } = createRequire(import.meta.url)(findPlaywright());

type Page = any;
type Mark = { t: number; label: string; [k: string]: unknown };
type Ev = { type: string; ts?: number; [k: string]: any };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (m: string) => console.log(`capture ${new Date().toTimeString().slice(0, 8)} ${m}`);

// A tidy gold cursor (headless video has no OS cursor) with a click ring: gold for left, red for right clicks.
const CURSOR = `(() => {
  const boot = () => {
    if (document.getElementById('cap-cursor')) return;
    const c = document.createElement('div');
    c.id = 'cap-cursor';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 30 30"><path d="M4 3 L4 24 L9.6 18.6 L13.4 27 L17.2 25.3 L13.5 17.2 L21 17.2 Z" fill="#f3d27a" stroke="#24170d" stroke-width="2" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 2px 2px rgba(0,0,0,.55))';
    document.documentElement.appendChild(c);
    const st = document.createElement('style');
    st.textContent = '*{cursor:none !important} @keyframes capring{from{transform:translate(-50%,-50%) scale(.3);opacity:1}to{transform:translate(-50%,-50%) scale(1.6);opacity:0}}';
    document.head.appendChild(st);
    const move = (e) => { c.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 3) + 'px)'; };
    addEventListener('pointermove', move, true);
    addEventListener('mousemove', move, true);
    addEventListener('pointerdown', (e) => {
      const r = document.createElement('div');
      const col = e.button === 2 ? '#ff6a4a' : '#f3d27a';
      r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;width:44px;height:44px;border:3px solid ' + col + ';border-radius:50%;z-index:2147483646;pointer-events:none;animation:capring .45s ease-out forwards';
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot();
})()`;

// In-page helper: screen position of a unit, camp or building (null when off screen or under the HUD).
const HELPERS = `(() => {
  window.capPos = (kind, id) => {
    const sc = window.raidScene; if (!sc) return null;
    const map = kind === 'unit' ? sc.units : kind === 'target' ? sc.targets : sc.buildings;
    const v = map.get(id); if (!v) return null;
    const p = v.group.position.clone();
    p.y += kind === 'unit' ? 0.45 : kind === 'target' ? 0.35 : 0.9;
    p.project(sc.iso.camera);
    const cv = sc.renderer.domElement.getBoundingClientRect();
    const x = Math.round(((p.x + 1) / 2) * cv.width + cv.left), y = Math.round(((1 - p.y) / 2) * cv.height + cv.top);
    if (x < 40 || y < 40 || x > innerWidth - 40 || y > innerHeight - 40) return null;
    const el = document.elementFromPoint(x, y);
    if (el !== sc.renderer.domElement) return null;
    return { x, y };
  };
  // Same projection without the HUD check (for marker positions; a panel may cover the unit).
  window.capPosAny = (kind, id) => {
    const sc = window.raidScene; if (!sc) return null;
    const map = kind === 'unit' ? sc.units : kind === 'target' ? sc.targets : sc.buildings;
    const v = map.get(id); if (!v) return null;
    const p = v.group.position.clone(); p.y += 0.45; p.project(sc.iso.camera);
    const cv = sc.renderer.domElement.getBoundingClientRect();
    const x = Math.round(((p.x + 1) / 2) * cv.width + cv.left), y = Math.round(((1 - p.y) / 2) * cv.height + cv.top);
    return x < 0 || y < 0 || x > innerWidth || y > innerHeight ? null : { x, y };
  };
})()`;

class Clip {
  marks: Mark[] = [];
  events: Ev[] = [];
  t0 = 0;
  page!: Page;
  ctx: any;
  private abort = new AbortController();
  private waiters: { pred: (e: Ev) => boolean; res: (e: Ev | null) => void }[] = [];
  constructor(public name: string) {}

  named: { t: number; name: string; x?: number; y?: number; [k: string]: unknown }[] = [];
  failures: { t: number; text: string }[] = [];
  /** Units and camps this clip drives: only their engine events become named editor events (others stay raw). */
  focus = new Set<string>();
  clickAt = 0;
  qmMode = false; // a QM web UI tab: engine events map to qm_order, qm_tool, qm_reply
  side: Promise<void>[] = []; // QM tabs recorded alongside this clip
  /** A failure note for the reviewer and editor (timeouts, API fallbacks, errors). */
  note_(text: string) { this.failures.push({ t: (Date.now() - this.t0) / 1000, text }); say(`[${this.name}] NOTE ${text}`); }
  lastXY: { x: number; y: number } | null = null;

  /** A scripted action: goes to the raw marks and, under the same name, to the editor's named events at the cursor. */
  mark(label: string, extra: Record<string, unknown> = {}, xy: { x: number; y: number } | null = this.lastXY, atMs = Date.now()) {
    const t = atMs - this.t0;
    this.marks.push({ t, label, ...extra });
    this.named.push({ t: t / 1000, ...extra, name: label.replace(/-/g, "_"), ...(xy ? { x: xy.x, y: xy.y } : {}) });
    say(`[${this.name}] ${(t / 1000).toFixed(1)}s ${label}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`);
  }

  /** Raw only (not an editor event): duplicates of engine events, kept for debugging. */
  log(label: string, extra: Record<string, unknown> = {}) {
    const t = Date.now() - this.t0;
    this.marks.push({ t, label, ...extra });
    say(`[${this.name}] ${(t / 1000).toFixed(1)}s (${label})`);
  }

  /** An engine event the editor cares about, placed at the unit or camp it concerns (screen px, resolved async). */
  private note(t: number, name: string, extra: Record<string, unknown>, at?: ["unit" | "target", string], to?: ["unit" | "target", string]) {
    const ev: { t: number; name: string; x?: number; y?: number; [k: string]: unknown } = { t: t / 1000, ...extra, name };
    this.named.push(ev);
    say(`[${this.name}] ${(t / 1000).toFixed(1)}s * ${name}`);
    const locate = (k: string, id: string) => this.page?.evaluate(`window.capPos ? capPos(${JSON.stringify(k)}, ${JSON.stringify(id)}) ?? capPosAny(${JSON.stringify(k)}, ${JSON.stringify(id)}) : null`).catch(() => null);
    if (at) void locate(at[0], at[1])?.then((p: any) => { if (p) { ev.x = p.x; ev.y = p.y; } });
    if (to) void locate(to[0], to[1])?.then((p: any) => { if (p) { ev.x2 = p.x; ev.y2 = p.y; } });
  }

  private named_(e: Ev, t: number) {
    const uid = e.unitId ?? e.order?.unitId;
    const ids = [uid, e.order?.targetId, e.run?.targetId, e.target?.id, e.fromUnitId, e.toUnitId].filter(Boolean);
    if (!ids.some((id) => this.focus.has(id))) return;
    if (this.qmMode) {
      if (!this.focus.has(uid)) return;
      if (e.type === "order.updated" && e.order?.status === "active") return this.note(t, "qm_order", { orderId: e.order.id, unitId: uid });
      if (e.type === "unit.activity" && e.kind === "tool" && /gbrain/i.test(String(e.tool ?? ""))) return this.note(t, "qm_tool", { unitId: uid, tool: e.tool });
      if (e.type === "order.updated" && e.order?.status === "done") return this.note(t, "qm_reply", { orderId: e.order.id, unitId: uid, text: String(e.order.reply ?? "").slice(0, 300) });
      return;
    }
    switch (e.type) {
      case "memory.recall": return this.note(t, "recall_beam", { unitId: uid, slugs: e.slugs }, ["unit", uid]);
      case "memory.remember": return this.note(t, "remember_orb", { unitId: uid, slug: e.slug }, ["unit", uid]);
      case "order.proposed": return this.note(t, "proposal", { orderId: e.order.id, unitId: uid, targetId: e.order.targetId }, ["unit", uid]);
      case "order.updated": {
        const st = e.order?.status, reply = String(e.order?.reply ?? "");
        if (st === "active") return this.note(t, "order_active", { orderId: e.order.id, unitId: uid, source: e.order.source }, ["unit", uid]);
        if (st === "done") {
          // The final VERDICT line decides (a quoted earlier verdict does not count), as in the engine.
          const lines = [...reply.matchAll(/^[\s*>_#-]*VERDICT:\s*(APPROVED|CHANGES)\b.*$/gim)];
          const last = lines.at(-1);
          const v = last ? (last[1].toUpperCase() === "APPROVED" ? "verdict_approved" : "verdict_changes") : "reply";
          const extra: Record<string, unknown> = { orderId: e.order.id, unitId: uid, source: e.order.source, nodeId: e.order.nodeId, text: reply.slice(0, 600) };
          if (last) extra.verdictLine = last[0].trim().slice(0, 200);
          else if (e.order.source === "workflow" && /review|judge/i.test(String(e.order.nodeId ?? ""))) extra.verdictNote = "no VERDICT line: if this was the reviewer step the engine counts it as approved by default";
          return this.note(t, v, extra, ["unit", uid]);
        }
        if (st === "failed" || st === "cancelled") return this.note(t, `order_${st}`, { orderId: e.order.id, unitId: uid }, ["unit", uid]);
        return;
      }
      case "workflow.handoff": return this.note(t, "handoff", { from: e.fromUnitId, to: e.toUnitId, nodeId: e.nodeId }, ["unit", e.fromUnitId], ["unit", e.toUnitId]);
      case "workflow.updated": {
        const st = e.run?.status;
        if (["done", "failed", "cancelled", "needs_human"].includes(st)) return this.note(t, `run_${st}`, { runId: e.run.id }, ["target", e.run.targetId]);
        return;
      }
      case "target.spawned": return this.note(t, "camp_spawned", { targetId: e.target?.id, issue: e.target?.issue, title: e.target?.title }, ["target", e.target?.id]);
      case "target.updated": return e.target?.status === "resolved" ? this.note(t, "camp_resolved", { targetId: e.target.id }, ["target", e.target.id]) : undefined;
      case "unit.spawned": return this.note(t, "unit_spawned", { unitId: e.unit?.id, class: e.unit?.class }, ["unit", e.unit?.id]);
      case "unit.activity": return e.kind === "tool" && /gbrain/i.test(String(e.tool ?? "")) ? this.note(t, "gbrain_tool", { unitId: uid, tool: e.tool }, ["unit", uid]) : undefined;
    }
  }

  /** Engine SSE through the board proxy: every event is a marker; waiters resolve on matching events. */
  async listen() {
    try {
      const res = await fetch(`${origin}/api/events`, { signal: this.abort.signal, headers: { accept: "text/event-stream" } });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("");
          if (!line) continue;
          let e: Ev;
          try { e = JSON.parse(line); } catch { continue; }
          this.onEvent(e);
        }
      }
    } catch { /* aborted at clip end */ }
  }

  private onEvent(e: Ev) {
    if (!this.t0 || e.type === "state.snapshot" || e.type === "unit.moved" || e.type === "stats") return;
    if (e.type === "unit.activity" && e.kind === "thinking") return;
    const t = Date.now() - this.t0;
    const brief: Record<string, unknown> = { t, label: `ev:${e.type}` };
    const o = e.order ?? e.run ?? e.target ?? e.unit ?? e.unitType ?? e.team;
    if (o?.id) brief.id = o.id;
    if (o?.status) brief.status = o.status;
    if (e.order?.unitId) brief.unitId = e.order.unitId;
    if (e.order?.targetId) brief.targetId = e.order.targetId;
    for (const k of ["unitId", "status", "kind", "tool", "slug", "fromUnitId", "toUnitId", "nodeId"]) if (e[k] != null) brief[k] = e[k];
    if (e.slugs) brief.slugs = e.slugs;
    const text = e.summary ?? e.text ?? e.order?.reply;
    if (typeof text === "string") brief.text = text.slice(0, 160);
    this.marks.push(brief as Mark);
    this.events.push(e);
    try { this.named_(e, t); } catch { /* odd payload: raw mark only */ }
    for (const w of [...this.waiters]) if (w.pred(e)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(e); }
  }

  /** Resolves with the first matching event (also one already seen since `since`), or null on timeout. */
  waitFor(pred: (e: Ev) => boolean, timeoutMs: number, label?: string): Promise<Ev | null> {
    const past = this.events.find(pred); // events that already arrived in this clip count too
    if (past) return Promise.resolve(past);
    return new Promise((res) => {
      const timer = setTimeout(() => { this.waiters = this.waiters.filter((w) => w.res !== done); if (label) this.note_(`timeout waiting for ${label}`); res(null); }, timeoutMs);
      const done = (e: Ev | null) => { clearTimeout(timer); res(e); };
      this.waiters.push({ pred, res: done });
    });
  }

  stop() { this.abort.abort(); for (const w of this.waiters) w.res(null); this.waiters = []; }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars"],
});
const pid = browser.process?.()?.pid;
say(`pid ${process.pid} (stop only this PID; it owns the headless browser${pid ? ` ${pid}` : ""}), url ${url}, out ${outDir}`);

const claimed = new Set<string>(); // units and camps used by earlier clips in this take
const js = (page: Page, code: string) => page.evaluate(code);
const state = (page: Page) => js(page, "raid.store.getState()");

async function glide(c: Clip, x: number, y: number, steps = 22) {
  await c.page.mouse.move(x, y, { steps });
}
async function clickAt(c: Clip, p: { x: number; y: number }, button: "left" | "right" = "left", mods: string[] = []) {
  c.lastXY = p;
  await glide(c, p.x, p.y);
  await wait(120);
  c.clickAt = Date.now();
  for (const m of mods) await c.page.keyboard.down(m);
  await c.page.mouse.click(p.x, p.y, { button });
  for (const m of mods) await c.page.keyboard.up(m);
}
async function posOf(c: Clip, kind: "unit" | "target" | "building", id: string, focus?: { x: number; y: number }) {
  let p = await js(c.page, `capPos(${JSON.stringify(kind)}, ${JSON.stringify(id)})`);
  if (!p && focus) {
    await js(c.page, `raid.bus.focusTile(${focus.x}, ${focus.y})`);
    await wait(900);
    p = await js(c.page, `capPos(${JSON.stringify(kind)}, ${JSON.stringify(id)})`);
  }
  return p as { x: number; y: number } | null;
}
/** Click a visible HUD control by its text or title (prefix match, case-insensitive). */
async function clickHud(c: Clip, selector: string, text?: string): Promise<boolean> {
  const box = await js(c.page, `(() => {
    const want = ${JSON.stringify((text ?? "").toLowerCase())};
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled &&
      (!want || (e.textContent || '').trim().toLowerCase().startsWith(want) || (e.getAttribute('title') || '').toLowerCase().startsWith(want)));
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) { say(`[${c.name}] no control ${selector} "${text ?? ""}"`); return false; }
  await clickAt(c, box);
  return true;
}
function openTargets(s: any, near?: { x: number; y: number }) {
  const busy = new Set(s.orders.filter((o: any) => o.status === "active" || o.status === "proposed").map((o: any) => o.targetId));
  const list = s.targets.filter((t: any) => t.status === "open" && !busy.has(t.id) && !claimed.has(t.id));
  if (near) list.sort((a: any, b: any) => Math.hypot(a.pos.x - near.x, a.pos.y - near.y) - Math.hypot(b.pos.x - near.x, b.pos.y - near.y));
  return list;
}
function idleUnits(s: any, pred: (u: any) => boolean = () => true) {
  const wfTeams = new Set(s.teams.filter((t: any) => t.workflow).map((t: any) => t.id));
  return s.units.filter((u: any) => u.status === "idle" && !u.orderId && !claimed.has(u.id) && pred(u) && !(u.team != null && wfTeams.has(u.team)));
}
/** Right-click a visible open camp (closest to `near` first); falls back to the API if none is clickable. */
async function orderCamp(c: Clip, unitIds: string[], near?: { x: number; y: number }, teamId?: number): Promise<string | null> {
  const s = await state(c.page);
  for (const t of openTargets(s, near).slice(0, 6)) {
    const p = await posOf(c, "target", t.id, t.pos);
    if (!p) continue;
    claimed.add(t.id); c.focus.add(t.id);
    await glide(c, p.x, p.y, 30);
    await wait(350); // crosshair hover
    await clickAt(c, p, "right");
    c.mark("order", { targetId: t.id, issue: t.issue, title: t.title, unitIds }, p, c.clickAt);
    if (has("debug")) await c.page.screenshot({ path: join(archiveDir, `${c.name}-rightclick.png`) });
    // The click must have produced an order within 3 s, else order through the API (same engine call the board makes).
    let ok = false;
    for (let i = 0; i < 12 && !ok; i++) {
      await wait(250);
      ok = await js(c.page, `raid.store.getState().orders.some(o => o.targetId === ${JSON.stringify(t.id)} && ['active', 'done'].includes(o.status)) || (raid.store.getState().workflowRuns ?? []).some(r => r.targetId === ${JSON.stringify(t.id)})`);
    }
    if (!ok) {
      await js(c.page, `raid.api.order(${JSON.stringify(teamId != null ? { teamId, targetId: t.id } : { unitIds, targetId: t.id })})`);
      c.log("order-via-api", { targetId: t.id });
      c.note_(`right-click on ${t.id} made no order in 3 s; ordered through the API instead`);
    }
    return t.id;
  }
  const t = openTargets(s, near)[0];
  if (!t) { c.mark("no-open-camp"); return null; }
  claimed.add(t.id); c.focus.add(t.id);
  await js(c.page, `raid.api.order(${JSON.stringify(teamId != null ? { teamId, targetId: t.id } : { unitIds, targetId: t.id })})`);
  c.mark("order-api", { targetId: t.id, issue: t.issue, unitIds });
  return t.id;
}
async function selectUnit(c: Clip, u: any, add = false) {
  const p = await posOf(c, "unit", u.id, u.pos);
  if (p) {
    await clickAt(c, p, "left", add ? ["Shift"] : []);
  } else {
    await js(c.page, `raid.bus.select([${JSON.stringify(u.id)}], { add: ${add} })`);
  }
  await wait(300);
  const sel: string[] = await js(c.page, "raid.bus.selection.units");
  if (!sel.includes(u.id)) await js(c.page, `raid.bus.select([${JSON.stringify(u.id)}], { add: ${add} })`);
}

// ---------------------------------------------------------------------------------------------- the clips
type Script = (c: Clip) => Promise<void>;
const clips: Record<string, Script> = {
  // Clip 1: select a knight, right-click a camp: march, recall beam, real reply, remember orb, page count.
  async orders(c) {
    const s = await state(c.page);
    const u = idleUnits(s, (x) => x.class === "knight")[0] ?? idleUnits(s)[0];
    if (!u) return c.mark("no-idle-unit");
    claimed.add(u.id); c.focus.add(u.id);
    const pages0 = s.memory?.pages;
    await selectUnit(c, u);
    c.mark("select", { unitId: u.id, unitName: u.name, class: u.class, model: u.model });
    let orderEnd: (v?: unknown) => void = () => {};
    c.side.push(qmTab(c, u.id, new Promise((r) => { orderEnd = r; })));
    await wait(2500); // QM tab loads and starts recording
    const tid = await orderCamp(c, [u.id], u.pos);
    if (!tid) { orderEnd(); return; }
    const mine = (e: Ev) => (e.unitId ?? e.order?.unitId) === u.id;
    c.waitFor((e) => e.type === "memory.recall" && mine(e), 120000).then((e) => e && c.log("recall", { slugs: e.slugs }));
    const end = await c.waitFor((e) => e.type === "order.updated" && e.order?.unitId === u.id && ["done", "failed", "cancelled"].includes(e.order?.status), Number(flag("order-wait", "110000")), "order end");
    if (end) c.log(`order-${end.order.status}`, { reply: String(end.order.reply ?? "").slice(0, 300) });
    orderEnd();
    const rem = await c.waitFor((e) => e.type === "memory.remember" && mine(e), 15000, "remember");
    if (rem) c.log("remember", { slug: rem.slug });
    await wait(3500);
    const lib = (await state(c.page)).buildings.find((b: any) => b.kind === "gbrain");
    if (lib) {
      const p = await posOf(c, "building", lib.id, { x: lib.x, y: lib.y });
      if (p) await clickAt(c, p); else await js(c.page, `raid.bus.selectBuilding(${JSON.stringify(lib.id)})`);
      c.mark("library", { pagesBefore: pages0, pagesNow: (await state(c.page)).memory?.pages });
      await wait(5000);
    }
  },

  // Clip 2: select three units, Form team, Trio, right-click a camp; handoffs to VERDICT: APPROVED.
  async teams(c) {
    let s = await state(c.page);
    // The reviewer is a River-trained Rule Warden (Forge type forge-rule-warden): reuse an idle one or train one now.
    const RW = flag("reviewer", "forge-rule-warden");
    let warden = idleUnits(s, (x) => x.class === RW)[0];
    if (!warden && s.unitTypes.some((t: any) => t.id === RW && t.status === "ready")) {
      const sp = c.waitFor((e) => e.type === "unit.spawned" && e.unit?.class === RW, 20000, "warden spawned");
      await js(c.page, `raid.api.spawn({ class: ${JSON.stringify(RW)} })`);
      const e = await sp;
      if (e) { c.focus.add(e.unit.id); c.mark("warden-trained", { unitId: e.unit.id, unitName: e.unit.name }, null); await wait(4500); s = await state(c.page); warden = s.units.find((u: any) => u.id === e.unit.id); }
    }
    let pool = idleUnits(s, (x) => x.team == null && x.id !== warden?.id && x.class !== RW);
    if (pool.length < (warden ? 2 : 3)) pool = idleUnits(s, (x) => x.id !== warden?.id && x.class !== RW);
    const three = warden ? [...pool.slice(0, 2), warden] : pool.slice(0, 3); // member order = planner, implementer, reviewer
    if (three.length < 3) return c.mark("need-3-idle-units");
    three.forEach((u: any) => { claimed.add(u.id); c.focus.add(u.id); });
    for (let i = 0; i < 3; i++) { await selectUnit(c, three[i], i > 0); await wait(350); }
    c.mark("select3", { unitIds: three.map((u: any) => u.id), unitNames: three.map((u: any) => u.name), reviewer: three[2].id, reviewerClass: three[2].class });
    // Overlapping sprites can add a neighbour on shift-click: pin the selection to exactly these three, in role order.
    await js(c.page, `raid.bus.select(${JSON.stringify(three.map((u: any) => u.id))})`);
    await wait(900);
    if (!(await clickHud(c, ".hud-wf-form"))) await js(c.page, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))");
    c.mark("form-team");
    await wait(1500);
    const sel: string[] = await js(c.page, "raid.bus.selection.units");
    const teamId: number | undefined = await js(c.page, `raid.store.unit(${JSON.stringify(three[0].id)})?.team`);
    await clickHud(c, ".hud-wf-card", "Trio");
    await wait(1200);
    // The Rule Warden must hold the reviewer node; if the preset bound someone else, set the trio graph explicitly.
    const wf = teamId != null ? await js(c.page, `raid.store.team(${teamId})?.workflow`) : null;
    const rev = wf?.nodes?.find((n: any) => n.role === "reviewer");
    if (teamId != null && (!rev || rev.unitId !== three[2].id)) {
      c.note_(`trio reviewer was ${rev?.unitId ?? "none"}, rebinding to ${three[2].id}`);
      const nodes = [{ id: "planner", role: "planner", unitId: three[0].id }, { id: "implementer", role: "implementer", unitId: three[1].id }, { id: "reviewer", role: "reviewer", unitId: three[2].id }];
      const edges = [{ from: "planner", to: "implementer", on: "done" }, { from: "implementer", to: "reviewer", on: "done" }, { from: "reviewer", to: "implementer", on: "changes" }];
      await js(c.page, `raid.api.setWorkflow(${teamId}, { workflow: ${JSON.stringify({ preset: "trio", entry: "planner", nodes, edges, maxLoops: 2 })} })`);
      await wait(800);
    }
    const bound = teamId != null ? await js(c.page, `raid.store.team(${teamId})?.workflow?.nodes?.map(n => n.role + ':' + n.unitId)`) : null;
    c.mark("trio", { teamId, selected: sel, roles: bound }, c.lastXY);
    await wait(1200);
    const cx = Math.round(three.reduce((a: number, u: any) => a + u.pos.x, 0) / 3), cy = Math.round(three.reduce((a: number, u: any) => a + u.pos.y, 0) / 3);
    // QM intercut: the implementer's own QM conversation (the Rule Warden is a River unit, not a QM session).
    let runEnd: (v?: unknown) => void = () => {};
    c.side.push(qmTab(c, three[1].id, new Promise((r) => { runEnd = r; })));
    await wait(2500);
    const tid = await orderCamp(c, three.map((u: any) => u.id), { x: cx, y: cy }, teamId);
    if (!tid) { runEnd(); return; }
    let n = 0;
    const handoffs = (e: Ev): boolean => { if (e.type === "workflow.handoff") { n++; c.mark(`handoff-${n}`, { from: e.fromUnitId, to: e.toUnitId, nodeId: e.nodeId }); } return false; };
    c.waitFor(handoffs, 600000);
    const end = await c.waitFor((e) => e.type === "workflow.updated" && e.run?.targetId === tid && ["done", "failed", "cancelled", "needs_human"].includes(e.run?.status), Number(flag("run-wait", "300000")), "run end");
    if (end) c.log(`run-${end.run.status}`);
    runEnd();
    await wait(4000);
  },

  // Clip 3: the Forge: describe a type, the Refund Ranger card (trained vs base), Train, it walks out and takes an order.
  async forge(c) {
    const s = await state(c.page);
    const forge = s.buildings.find((b: any) => b.kind === "river");
    if (!forge) return c.mark("no-forge");
    const p = await posOf(c, "building", forge.id, { x: forge.x, y: forge.y });
    if (p) await clickAt(c, p); else await js(c.page, `raid.bus.selectBuilding(${JSON.stringify(forge.id)})`);
    c.mark("forge-open");
    await wait(1800);
    const name = await js(c.page, `(() => { const i = document.querySelector('input.pnl-input'); if (!i) return null; const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (name) {
      await clickAt(c, name);
      await c.page.keyboard.type("Refund Ranger", { delay: 45 });
      const job = await js(c.page, `(() => { const i = document.querySelector('textarea.pnl-input'); const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
      await clickAt(c, job);
      await c.page.keyboard.type("Answers refund and billing complaints in the house tone and cites the refund rules.", { delay: 22 });
      c.mark("described");
      await wait(700);
      if (forgeSubmit) { await clickHud(c, "button.pnl-btn-river"); c.mark("forge-submit"); await wait(2500); }
    }
    // The ready Refund Ranger card: scroll it into view, open the held-out sample, press Train.
    const types = (await state(c.page)).unitTypes.filter((t: any) => t.source === "forge" && t.status === "ready");
    const RR = flag("ranger", "forge-refund-ranger-2"); // exact checkpoint: 0.82 vs 0.42 overall
    const rr = types.find((t: any) => t.id === RR);
    if (!rr) { c.note_(`${RR} not ready on this engine`); return c.mark("no-ready-forged-type"); }
    // The exact numbers the card shows, from the same engine proxy the board calls.
    const evalFor = (id: string) => js(c.page, `raid.api.get("/api/forge/types/" + encodeURIComponent(${JSON.stringify(id)}) + "/eval")`).then((r: any) => {
      if (!r?.ok) { c.note_(`eval for ${id} unavailable through the engine: ${r?.error}`); return { evalError: r?.error ?? "unavailable" }; }
      const m = (r.metrics ?? []).find((x: any) => x.key === "overall");
      return { baseModel: r.baseModel ?? null, evalOrders: r.evalOrders ?? null, overallTrained: m?.trained ?? null, overallBase: m?.base ?? null, metrics: r.metrics };
    }).catch(() => ({ evalError: "request failed" }));
    const cardXY = (typeId: string) => js(c.page, `(() => { const t = raid.store.getState().unitTypes.find(x => x.id === ${JSON.stringify(typeId)}); const b = t && document.querySelector('button[title=' + JSON.stringify('Train a ' + t.name) + ']'); const card = b?.closest('.pnl-type'); if (!card) return null; card.scrollIntoView({ block: 'center', behavior: 'smooth' }); const r = card.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    // Both River cards: the Rule Warden first, then the Refund Ranger we train.
    const rw = types.find((t: any) => t.id === "forge-rule-warden");
    if (rw) {
      const xy = await cardXY(rw.id);
      await wait(900);
      if (xy) await glide(c, xy.x, xy.y);
      c.mark("card", { typeId: rw.id, typeName: rw.name, model: rw.model, ...(await evalFor(rw.id)) }, xy);
      await wait(3000);
    }
    const xy = await cardXY(rr.id);
    await wait(900);
    if (xy) await glide(c, xy.x, xy.y);
    c.mark("card", { typeId: rr.id, typeName: rr.name, model: rr.model, ...(await evalFor(rr.id)) }, xy);
    await wait(3000);
    const spawned = c.waitFor((e) => e.type === "unit.spawned" && e.unit?.class === rr.id, 20000, "unit.spawned");
    if (!(await clickHud(c, `button[title=${JSON.stringify(`Train a ${rr.name}`)}]`))) await js(c.page, `raid.api.spawn({ class: ${JSON.stringify(rr.id)} })`);
    c.mark("train", { typeId: rr.id, model: rr.model });
    const sp = await spawned;
    if (!sp) return;
    const uid = sp.unit.id;
    claimed.add(uid); c.focus.add(uid);
    c.mark("spawned", { unitId: uid, unitName: sp.unit.name });
    await wait(1000);
    await js(c.page, "raid.bus.clear()");
    await wait(3000); // walks out of the Forge
    const u = await js(c.page, `raid.store.unit(${JSON.stringify(uid)})`);
    await selectUnit(c, u);
    c.mark("select", { unitId: uid });
    await wait(900);
    const tid = await orderCamp(c, [uid], u.pos);
    if (!tid) return;
    const mine = (e: Ev) => (e.unitId ?? e.order?.unitId) === uid;
    c.waitFor((e) => e.type === "memory.recall" && mine(e), 120000).then((e) => e && c.log("recall", { slugs: e.slugs }));
    const end = await c.waitFor((e) => e.type === "order.updated" && e.order?.unitId === uid && ["done", "failed", "cancelled"].includes(e.order?.status), Number(flag("forge-wait", "60000")), "order end");
    if (end) c.log(`order-${end.order.status}`, { reply: String(end.order.reply ?? "").slice(0, 300) });
    await wait(4000);
  },

  // Clip 4: new issue button, a camp appears; autopilot proposals with veto rings; cancel one, let one go.
  async autopilot(c) {
    await clickHud(c, "button.hud-top-btn", "New issue");
    await wait(1200);
    const spawned = c.waitFor((e) => e.type === "target.spawned", 20000, "target.spawned");
    if (!(await clickHud(c, "button.nix-btn"))) await js(c.page, "raid.api.spawnTarget({})");
    c.mark("new-issue");
    const sp = await spawned;
    if (sp) { claimed.add(sp.target.id); c.focus.add(sp.target.id); c.mark("camp-spawned", { targetId: sp.target.id, issue: sp.target.issue, title: sp.target.title }); }
    await js(c.page, `(() => { const t = raid.store.getState().targets.find(x => x.id === ${JSON.stringify(sp?.target?.id ?? "")}); if (t) raid.bus.focusTile(t.pos.x, t.pos.y); })()`);
    await wait(3500);
    await js(c.page, "raid.bus.clear()");
    // A team with two or more idle members and no formation.
    const s = await state(c.page);
    const idle = new Set(idleUnits(s).map((u: any) => u.id));
    const team = s.teams.filter((t: any) => !t.workflow && t.members.filter((m: string) => idle.has(m)).length >= 1)
      .sort((a: any, b: any) => b.members.filter((m: string) => idle.has(m)).length - a.members.filter((m: string) => idle.has(m)).length)[0];
    if (!team) return c.mark("no-team-for-autopilot");
    team.members.forEach((m: string) => { claimed.add(m); c.focus.add(m); });
    const proposals: Ev[] = [];
    const firstProp = c.waitFor((e) => { if (e.type === "order.proposed") proposals.push(e); return e.type === "order.proposed"; }, 40000, "order.proposed");
    const toggled = await clickHud(c, `button.hud-team[title^=${JSON.stringify(`${team.name}, group ${team.id}`)}]`);
    if (!toggled) await js(c.page, `raid.api.patchTeam(${team.id}, { autopilot: true })`);
    c.mark("autopilot-on", { teamId: team.id, teamName: team.name });
    const p1 = await firstProp;
    if (!p1) return;
    c.mark("proposed", { orderId: p1.order.id, unitId: p1.order.unitId, targetId: p1.order.targetId, vetoDeadline: p1.order.vetoDeadline });
    await wait(2500);
    const more = proposals.length;
    await wait(4000); // veto rings count down
    // Veto the first proposal with its card's Cancel button, then confirm the engine cancelled it.
    const vetoed = c.waitFor((e) => e.type === "order.updated" && e.order?.source === "autopilot" && e.order?.status === "cancelled", 4000);
    const clicked = await clickHud(c, "button.hud-btn-cancel", "Cancel");
    let ev = await vetoed;
    if (!ev) {
      c.note_(`veto click ${clicked ? "made no cancellation" : "found no Cancel button"}; cancelled ${p1.order.id} through the API`);
      await js(c.page, `raid.api.cancelOrder(${JSON.stringify(p1.order.id)})`);
      ev = await c.waitFor((e) => e.type === "order.updated" && e.order?.id === p1.order.id && e.order?.status === "cancelled", 4000, "veto cancel");
    }
    c.mark(ev ? "veto" : "veto-missing", { orderId: ev?.order?.id ?? p1.order.id, unitId: ev?.order?.unitId, confirmed: !!ev, proposals: proposals.length + (more ? 0 : 0) });
    // The other proposal runs out its ring and goes by itself.
    const went = await c.waitFor((e) => e.type === "order.updated" && e.order?.source === "autopilot" && e.order?.status === "active", 20000, "autopilot go");
    if (went) c.mark("autopilot-go", { orderId: went.order.id, unitId: went.order.unitId });
    await wait(4000);
    // Autopilot off again so it cannot touch the other clips.
    await clickHud(c, `button.hud-team[title^=${JSON.stringify(`${team.name}, group ${team.id}`)}]`);
    await js(c.page, `raid.api.patchTeam(${team.id}, { autopilot: false })`);
    c.mark("autopilot-off");
    await wait(1500);
  },

  // Clip 5: edit a unit's standing orders and skills in game (Loadout tab, Apply).
  async loadout(c) {
    const s = await state(c.page);
    // Analyst HOLD 16:04: no loadout PATCH on real QM units until raid-qm-impl's fix; mock only unless --loadout-real.
    if (s.backend !== "mock" && !has("loadout-real")) { c.note_(`loadout skipped: backend ${s.backend} (HOLD, pass --loadout-real after the all clear)`); return c.mark("loadout-skipped"); }
    const u = idleUnits(s, (x) => x.class === "knight")[0] ?? idleUnits(s)[0] ?? s.units[0];
    claimed.add(u.id); c.focus.add(u.id);
    await selectUnit(c, u);
    c.mark("select", { unitId: u.id, unitName: u.name });
    await wait(1200);
    await clickHud(c, "#hud button.hud-tab", "Loadout");
    await wait(300);
    // The side panel's box, so the editor can punch in on the 3 s edit.
    const panel = await js(c.page, `(() => { const el = document.querySelector('.ldo')?.closest('section, aside, .hud-side, [class*=side]') ?? document.querySelector('.ldo'); if (!el) return null; const r = el.getBoundingClientRect(); return { px: Math.round(r.left), py: Math.round(r.top), pw: Math.round(r.width), ph: Math.round(r.height) }; })()`);
    c.mark("loadout-open", panel ?? {});
    await wait(1800);
    await clickHud(c, "button.ldo-chip", "House rules");
    await wait(700);
    await clickHud(c, "button.ldo-chip", "Recall first");
    c.mark("orders-chips");
    await wait(900);
    const box = await js(c.page, `(() => { const i = [...document.querySelectorAll('.ldo-item input[type=checkbox]')].find(x => !x.checked && x.getClientRects().length); if (!i) return null; i.scrollIntoView({ block: 'nearest' }); const r = i.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (box) { await clickAt(c, box); c.mark("skill"); }
    await wait(1000);
    const upd = c.waitFor((e) => e.type === "unit.updated" && e.unit?.id === u.id, 30000, "unit.updated");
    await clickHud(c, "button.ldo-btn", "Apply");
    c.mark("save");
    const e = await upd;
    if (e) c.mark("applied", { unitId: u.id, instructions: String(e.unit?.loadout?.instructions ?? "").slice(0, 400), skills: e.unit?.loadout?.skills, plugins: e.unit?.loadout?.plugins });
    await wait(2500);
    // The next order carries the new standing orders: order a camp and record the unit's first messages.
    await clickHud(c, "#hud button.hud-tab", "Activity");
    await wait(600);
    const me = await js(c.page, `raid.store.unit(${JSON.stringify(u.id)})`);
    const tid = await orderCamp(c, [u.id], me?.pos);
    if (!tid) return;
    const mine = (x: Ev) => (x.unitId ?? x.order?.unitId) === u.id;
    c.waitFor((x) => x.type === "unit.activity" && x.kind === "message" && mine(x), 90000).then((x) => x && c.mark("first-message", { text: String(x.text ?? "").slice(0, 300) }, null));
    const end = await c.waitFor((x) => x.type === "order.updated" && x.order?.unitId === u.id && ["done", "failed", "cancelled"].includes(x.order?.status), Number(flag("loadout-wait", "150000")), "loadout order end");
    if (end) c.log(`order-${end.order.status}`, { reply: String(end.order.reply ?? "").slice(0, 400) });
    await wait(3000);
  },
};

// Recording: a CDP screencast (JPEG frames with swap timestamps) re-timed by ffmpeg into a 30 fps H.264 mp4.
// (Playwright recordVideo hung on close under Bun and is capped near 1 Mbit/s VP8.) The clip starts once the board is
// loaded, so t = 0 is a ready board; marker times are shifted to the first frame.
// Hero (Emre 15:58): the first 2 s of the video, sharp gameplay for the thumbnail. No cursor; several units march at
// once while the others still work; recording runs until the first recall beam plus 5 s (the editor picks 2 s).
clips.hero = async (c) => {
  await js(c.page, "document.getElementById('cap-cursor')?.style.setProperty('display', 'none')"); // clean thumbnail
  await js(c.page, "raid.bus.clear()");
  await wait(1500);
  let s = await state(c.page);
  const want = Number(flag("hero-units", "3"));
  // Few idle units left after the other clips: train knights at the Barracks so the map fills with marching units.
  const short = want - idleUnits(s).length;
  for (let i = 0; i < short && i < 2; i++) {
    const sp = c.waitFor((e) => e.type === "unit.spawned" && !claimed.has(e.unit?.id) && !c.focus.has(e.unit?.id), 20000, "hero knight");
    await js(c.page, "raid.api.spawn({ class: 'knight' })");
    const e = await sp;
    if (e) { c.focus.add(e.unit.id); c.mark("hero-spawn", { unitId: e.unit.id, unitName: e.unit.name }, null); }
  }
  if (short > 0) { await wait(2000); s = await state(c.page); }
  const us = idleUnits(s).slice(0, want);
  const used = new Set<string>();
  for (const u of us) {
    const t = openTargets(s, u.pos).find((x: any) => !used.has(x.id));
    if (!t) break;
    used.add(t.id); claimed.add(t.id); claimed.add(u.id); c.focus.add(t.id); c.focus.add(u.id);
    await js(c.page, `raid.api.order(${JSON.stringify({ unitIds: [u.id], targetId: t.id })})`);
    c.mark("hero-order", { unitId: u.id, targetId: t.id, issue: t.issue }, null);
    await wait(250);
  }
  // Any unit's recall counts (units busy from the earlier clips too).
  const beam = await c.waitFor((e) => e.type === "memory.recall", Number(flag("hero-wait", "60000")), "hero recall beam");
  if (beam) c.mark("hero-beam", { unitId: beam.unitId }, null);
  await wait(5000);
};

const pending: Promise<void>[] = [];
type Rec = { frames: { file: string; ts: number }[]; frameDir: string; stop: () => Promise<void> };

/** Starts the CDP screencast of c.page and the clip clock (t0) and SSE listener. */
async function startRec(c: Clip): Promise<Rec> {
  const frameDir = join(tmpdir(), `raid-cap-${take}-${c.name}-${process.pid}`);
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const frames: { file: string; ts: number }[] = [];
  const cdp = await c.ctx.newCDPSession(c.page);
  cdp.on("Page.screencastFrame", (f: any) => {
    const file = join(frameDir, `f${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, ts: (f.metadata?.timestamp ?? Date.now() / 1000) * 1000 });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  c.t0 = Date.now();
  void c.listen();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 86, maxWidth: W, maxHeight: H, everyNthFrame: Number(flag("nth", "2")) }); // about 30 fps at a 60 Hz swap
  return { frames, frameDir, stop: async () => { await cdp.send("Page.stopScreencast").catch(() => {}); } };
}

/** Re-times the frames (each lasts until the next; concat demuxer plus cfr gives a steady 30 fps), encodes in the
 *  background (niced) and writes the markers when the mp4 is done. */
function finishRec(c: Clip, rec: Rec, backend: string, pageUrl = url) {
  const { frames, frameDir } = rec;
  const name = c.name;
  const first = frames[0]?.ts ?? c.t0;
  const shift = first - c.t0;
  const list = join(frameDir, "list.txt");
  const lines: string[] = [];
  frames.forEach((f, i) => { lines.push(`file '${f.file}'`, `duration ${(Math.max(1, (frames[i + 1]?.ts ?? f.ts + 33) - f.ts) / 1000).toFixed(4)}`); });
  if (frames.length) lines.push(`file '${frames.at(-1)!.file}'`);
  writeFileSync(list, lines.join("\n"));
  const mp4 = join(outDir, `${name}.mp4`);
  const encoded = new Promise<void>((res) => {
    const ff = spawn("nice", ["-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-fps_mode", "cfr", "-r", "30",
      "-vf", `scale=${W}:${H}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-movflags", "+faststart", mp4]);
    say(`[${name}] encoding pid ${ff.pid}`);
    let err = "";
    ff.stderr?.on("data", (d) => { err += String(d); });
    ff.on("close", (code) => { if (code !== 0) c.note_(`ffmpeg failed: ${err.slice(0, 300)}`); if (!has("keep-frames")) rmSync(frameDir, { recursive: true, force: true }); res(); });
  });
  for (const m of c.marks) m.t -= shift;
  for (const e of c.named) e.t = Math.round((e.t - shift / 1000) * 1000) / 1000;
  const duration = frames.length ? (frames.at(-1)!.ts - first) / 1000 : 0;
  const doc = { clip: name, take, file: mp4, url: pageUrl, backend, width: W, height: H, fps: 30, frames: frames.length, duration,
    startedAt: new Date(first).toISOString(), startedAtMs: Math.round(first),
    note: "t is seconds from the first video frame (source time in this file); x, y are screen px (x2, y2 = receiver of a handoff); raw has every scripted mark and engine SSE event (t in ms); failures lists timeouts, API fallbacks and errors",
    failures: c.failures, events: c.named.sort((a, b) => a.t - b.t), raw: c.marks };
  const mfile = join(outDir, `${name}.markers.json`);
  pending.push(encoded.then(() => {
    doc.failures = c.failures;
    writeFileSync(mfile, JSON.stringify(doc, null, 2));
    if (existsSync(mp4)) copyFileSync(mp4, join(archiveDir, `${name}.mp4`));
    copyFileSync(mfile, join(archiveDir, `${name}.markers.json`));
    say(`[${name}] saved ${mp4} (${duration.toFixed(1)} s, ${frames.length} frames, ${doc.events.length} events, ${c.failures.length} failure notes)`);
    const to = flag("notify", "");
    if (to) {
      const key = doc.events.filter((e) => !["gbrain_tool", "order_active"].includes(e.name)).map((e) => `${e.name}@${e.t.toFixed(1)}`).slice(0, 18).join(" ");
      const fails = c.failures.map((f) => f.text).join("; ");
      for (const who of to.split(",")) spawn("herdr", ["agent", "prompt", who, `raid-video-cap: ${take} clip ${name} ready (${backend}): ${mp4} ${duration.toFixed(1)} s + ${name}.markers.json. ${key}${fails ? `. FAILURES: ${fails}` : ""}`], { stdio: "ignore" });
    }
  }));
  return doc;
}

/** QM intercut (Emre 16:11): the unit's own conversation in QM's web UI (8129), recorded in a second tab of the same
 *  browser into <parent>-qm.mp4 while the map clip runs. Ends when `until` settles, plus 4 s. Never types anything. */
async function qmTab(parent: Clip, unitId: string, until: Promise<unknown>): Promise<void> {
  if (has("no-qm")) return;
  const u = await js(parent.page, `raid.store.unit(${JSON.stringify(unitId)})`).catch(() => null);
  const sessionUrl = u?.qm?.sessionUrl;
  if (!sessionUrl || !/^http:\/\/(localhost|127\.0\.0\.1):8129\//.test(sessionUrl)) { parent.note_(`no QM session URL for ${unitId}`); return; }
  const q = new Clip(`${parent.name}-qm`);
  q.qmMode = true;
  q.focus.add(unitId);
  q.ctx = parent.ctx;
  try {
    q.page = await parent.ctx.newPage();
    await q.page.goto(sessionUrl, { waitUntil: "load", timeout: 30000 });
    await wait(1500);
    // Keep the newest turn in view (QM's chat pane or the page itself).
    await js(q.page, `window.capScroll = setInterval(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) { if (el && el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight; } window.scrollTo(0, document.body.scrollHeight); }, 700)`).catch(() => {});
    const rec = await startRec(q);
    await wait(800);
    q.mark("ready", { backend: "qm", unitId, sessionUrl }, null);
    q.mark("qm-open", { unitId }, null);
    await Promise.race([until, wait(Number(flag("qm-max", "300000")))]);
    await wait(2500);
    // Unfold the last turn's tool calls ("Worked for Ns"), so the GBrain calls are on screen.
    await js(q.page, "clearInterval(window.capScroll)").catch(() => {});
    const worked = q.page.getByText(/^Worked for /).last();
    if (await worked.count().catch(() => 0)) {
      await worked.scrollIntoViewIfNeeded().catch(() => {});
      await wait(500);
      await worked.click({ timeout: 3000 }).then(() => q.mark("qm-tools-open", {}, null)).catch(() => q.note_("could not unfold Worked for"));
      await wait(1200);
      await js(q.page, "window.scrollBy(0, 300)").catch(() => {});
    }
    await wait(4500);
    q.mark("end", {}, null);
    q.stop();
    await rec.stop();
    await wait(300);
    await q.page.close().catch(() => {});
    finishRec(q, rec, "qm", sessionUrl);
  } catch (err) {
    parent.note_(`QM tab failed: ${String((err as Error).message).split("\n")[0]}`);
  }
}

async function run(name: string, script: Script) {
  const c = new Clip(name);
  c.ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await c.ctx.addInitScript(CURSOR);
  await c.ctx.addInitScript(HELPERS); // survives a dev-server reload mid-clip
  c.page = await c.ctx.newPage();
  c.page.on("pageerror", (e: Error) => { if (c.t0) c.note_("pageerror: " + e.message.slice(0, 200)); });
  await c.page.goto(url, { waitUntil: "load" });
  await c.page.waitForFunction("window.raid && window.raidScene && raid.store.getState().units.length > 0", null, { timeout: 20000 }).catch(() => {});
  await js(c.page, HELPERS);
  await js(c.page, CURSOR);
  await c.page.mouse.move(W - 260, H / 2 - 120);
  await wait(2500); // SSE snapshot, scene build, first frames
  const backend = await js(c.page, "raid.store.getState().backend").catch(() => "unknown");
  const rec = await startRec(c);
  await wait(1200);
  c.mark("ready", { backend });
  try {
    await script(c);
  } catch (err) {
    c.note_("script error: " + String((err as Error).message).split("\n")[0]);
    c.mark("script-error", { text: String((err as Error).message).split("\n")[0] });
  }
  await Promise.race([Promise.all(c.side), wait(20000)]); // QM tabs finish before the context closes
  await wait(1500);
  c.mark("end");
  c.stop();
  await rec.stop();
  await wait(500);
  await c.ctx.close();
  return finishRec(c, rec, backend);
}

const order = ["orders", "teams", "forge", "autopilot", "loadout", "hero"].filter((n) => !only.length || only.includes(n));
const results: any[] = [];
try {
  if (has("parallel") && order.includes("teams")) {
    // The trio run is the slowest: record it alongside the others (same browser, second context).
    const teamsRun = (async () => { await wait(1500); return run("teams", clips.teams); })();
    for (const n of order.filter((x) => x !== "teams")) results.push(await run(n, clips[n]));
    results.push(await teamsRun);
  } else {
    for (const n of order) results.push(await run(n, clips[n]));
  }
} catch (err) {
  say(`run failed: ${String((err as Error).message).split("\n")[0]}`);
}
await Promise.all(pending); // mp4s and markers first: browser.close() can hang under Bun
const index = join(outDir, "markers.json");
writeFileSync(index, JSON.stringify({ take, url, createdAt: new Date().toISOString(), clips: results.map((r) => ({ clip: r.clip, file: r.file, duration: r.duration, markers: join(outDir, `${r.clip}.markers.json`) })) }, null, 2));
copyFileSync(index, join(archiveDir, "markers.json"));
say(`done: ${results.length} clips, index ${index}`);
await Promise.race([browser.close(), wait(5000)]);
process.exit(0);
