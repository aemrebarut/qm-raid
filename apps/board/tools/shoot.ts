// Look team screenshot loop: captures fixed board states at two viewports into docs/shots/look/.
// Usage: bun apps/board/tools/shoot.ts <iteration> [--url 'http://127.0.0.1:4619/?art=on'] [--only overview,library] [--sizes 1512x790,1280x720] [--live]
// Test board only (mock engine 4618 behind 4619). Never point this at 4611: it only reads state and
// injects local dev events (window.raid.dev), but the live board talks to real QM agents.
// Playwright is not a board dependency: set PLAYWRIGHT_DIR to a playwright package dir, or it is found in the npx cache.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const iteration = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")) ?? "i0";
const url = flag("url", "http://127.0.0.1:4619");
if (/:4611\b/.test(url)) {
  console.error("shoot: refusing to run against the live board on 4611; use the test board 4619");
  process.exit(2);
}
const only = flag("only", "").split(",").filter(Boolean);
const live = argv.includes("--live"); // also send real orders and train a forged unit on the mock engine (never 4611)
const sizes = flag("sizes", "1512x790,1280x720").split(",").map((s) => s.split("x").map(Number) as [number, number]);
const outDir = resolve(import.meta.dir, "../../../docs/shots/look");
mkdirSync(outDir, { recursive: true });

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const js = (page: Page, code: string) => page.evaluate(code);

// Each state starts from a clean selection. Steps run in the page through window.raid (see src/main.ts).
// Without --live the page is read-only against the engine (non-GET /api calls are aborted) and every team
// state is built locally with store.apply, so shots never change the shared mock and never depend on its drift.
const RESET = `(() => { raid.bus.clear(); raid.bus.selectBuilding(null); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); })()`;
const firstIds = (n: number) => `raid.store.getState().units.slice(0, ${n}).map(u => u.id)`;
// In-page helper: a local team (id, members, optional trio workflow from the fixture), applied as a synthetic event.
const HELPERS = `window.__look = {
  n: 0,
  async team(id, members, trio) {
    let wf = null;
    if (trio) {
      const { fixtureState } = await import('/src/core/fixture.ts');
      wf = structuredClone(fixtureState().teams.find(t => t.workflow && t.workflow.preset === 'trio')?.workflow ?? null);
      if (wf) wf.nodes.forEach((nd, i) => { nd.unitId = members[i] ?? nd.unitId; });
    }
    const colors = { 1: '#d64545', 2: '#3f7fd6', 7: '#4caf6a' };
    const prev = raid.store.team(id);
    const team = { id, name: prev?.name ?? (id === 1 ? 'Red' : 'Squad'), color: prev?.color ?? colors[id] ?? '#c9a24a', autopilot: false, members, workflow: wf };
    for (const t of raid.store.getState().teams) if (t.id !== id && t.members.some(m => members.includes(m)))
      raid.store.apply({ seq: -(900000 + ++this.n), ts: Date.now(), type: 'team.updated', team: { ...t, members: t.members.filter(m => !members.includes(m)) } });
    raid.store.apply({ seq: -(900000 + ++this.n), ts: Date.now(), type: 'team.updated', team });
    return team;
  },
};`;
type State = { name: string; setup: string; check?: string; settle?: number; keys?: string[]; click?: string; live?: boolean };
const sel = (n: number) => `raid.bus.selection.units.length === ${n}`;
const states: State[] = [
  { name: "overview", setup: `1` },
  { name: "unit", setup: `raid.bus.select(${firstIds(1)})`, check: sel(1) },
  { name: "units", setup: `raid.bus.select(${firstIds(4)})`, check: sel(4) },
  { name: "target", setup: `raid.bus.selectTarget((raid.store.getState().targets.find(t => t.status === 'open') ?? raid.store.getState().targets[0]).id)`, check: `!!raid.bus.selection.target` },
  { name: "library", setup: `raid.bus.selectBuilding(raid.store.getState().buildings.find(b => b.kind === 'gbrain').id)`, settle: 2500, check: `!!raid.bus.selection.building` },
  { name: "forge", setup: `raid.bus.selectBuilding(raid.store.getState().buildings.find(b => b.kind === 'river').id)`, settle: 1500, check: `!!raid.bus.selection.building` },
  { name: "barracks", setup: `raid.bus.selectBuilding(raid.store.getState().buildings.find(b => b.kind === 'barracks').id)`, check: `!!raid.bus.selection.building` },
  { name: "proposals", setup: `(() => { const us = raid.store.getState().units; const ts = raid.store.getState().targets.filter(t => t.status === 'open'); for (let i = 0; i < 3; i++) raid.dev.propose(us[i]?.id, ts[i]?.id); })()`, check: `raid.store.getState().orders.filter(o => o.status === 'proposed').length >= 3` },
  { name: "workflow", setup: `(async () => { const t = await __look.team(1, ${firstIds(3)}, true); raid.dev.workflow(1, undefined, 1200); raid.bus.select(t.members); })()`, settle: 3200, check: `raid.store.getState().workflowRuns.some(r => r.teamId === 1 && r.status === 'running')` },
  { name: "spawn", setup: `raid.bus.newIssue()`, settle: 700 },
  // Emre's formation flow. 'formation' = what F shows right after it forms a new team (two units, no workflow yet).
  { name: "formation", setup: `(async () => { const ids = raid.store.getState().units.slice(3, 5).map(u => u.id); await __look.team(7, ids, false); raid.bus.select(ids); })()`, settle: 1200, check: sel(2) },
  { name: "presets", setup: `(async () => { const t = await __look.team(1, ${firstIds(3)}, false); raid.bus.select(t.members); })()`, settle: 1200, check: `raid.store.team(1)?.workflow === null && ${sel(3)}` },
  { name: "rolepick", setup: `(async () => { const t = await __look.team(1, ${firstIds(3)}, true); raid.bus.select(t.members); await new Promise(r => setTimeout(r, 300)); raid.bus.setCommand({ kind: 'role', teamId: 1, nodeId: t.workflow.entry }); })()`, settle: 1200, check: `raid.bus.command?.kind === 'role'` },
  // Loadout (Emre 15:40): a tab in the unit side panel (hud/loadout.ts, mounted by raid-look-hud).
  { name: "loadout", setup: `raid.bus.select(${firstIds(1)})`, click: "Loadout", settle: 1500, check: `!![...document.querySelectorAll('#hud [role=tab][aria-selected=true]')].find(e => /loadout/i.test(e.textContent))` },
  // --live only: real orders and a forged unit on the mock test engine 4618 (art gate: units selectable and movable).
  { name: "order", live: true, setup: `(async () => { const s = raid.store.getState(); const u = s.units.find(x => x.status === 'idle') ?? s.units[0]; const t = s.targets.find(x => x.status === 'open'); if (t) await raid.api.order({ unitIds: [u.id], targetId: t.id }); raid.bus.select([u.id]); })()`, settle: 4000, check: sel(1) },
  { name: "forged", live: true, setup: `(async () => { const s = raid.store.getState(); const base = ['knight','ranger','scout','oracle']; let u = s.units.find(x => !base.includes(x.class)); if (!u) { const ty = s.unitTypes.find(x => !base.includes(x.id) && x.status === 'ready'); if (ty) { const r = await raid.api.spawn({ class: ty.id }); u = r.unit; } } await new Promise(r => setTimeout(r, 1500)); u = u && raid.store.unit(u.id); if (!u) return; const t = raid.store.getState().targets.find(x => x.status === 'open'); if (t) await raid.api.order({ unitIds: [u.id], targetId: t.id }); raid.bus.select([u.id]); })()`, settle: 4000, check: sel(1) },
  { name: "feed", setup: `(() => { const d = raid.dev; const [a, b, c] = ${firstIds(3)}; d.recall(a); d.remember(b); d.handoff(a, b); d.recall(c); d.remember(a); raid.bus.select([a]); })()`, settle: 1200, check: sel(1) },
];

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl"],
});
const pid = browser.process?.()?.pid;
if (pid) console.log(`shoot: browser pid ${pid}`);
const saved: string[] = [];
try {
  for (const [w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    for (const st of states) {
      if (only.length && !only.includes(st.name)) continue;
      if (st.live && !live) continue;
      // Fresh page per state so injected dev events do not leak between shots.
      const page = await ctx.newPage();
      if (!live) await page.route("**/api/**", (r: any) => (r.request().method() === "GET" ? r.continue() : r.abort()));
      page.on("pageerror", (e: Error) => console.warn(`  [${st.name}] pageerror: ${e.message}`));
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction("window.raid && raid.store.getState().units.length > 0", null, { timeout: 15000 }).catch(() => {});
      await wait(2500); // SSE snapshot, scene build, first frames
      // A teammate mid-edit can break the module graph (no window.raid): shoot the broken page anyway as evidence.
      try {
        await js(page, HELPERS);
        await js(page, RESET);
        await js(page, st.setup);
      } catch (err) {
        console.warn(`  [${st.name}] setup failed: ${String((err as Error).message).split("\n")[0]}`);
      }
      await page.mouse.move(w - 5, Math.round(h / 2)); // park the cursor off the HUD
      for (const k of st.keys ?? []) await page.keyboard.press(k);
      if (st.click) {
        await wait(400);
        const hit = await js(page, `(() => { const want = ${JSON.stringify(st.click)}.toLowerCase(); const el = [...document.querySelectorAll('#hud button, #hud [role=tab], #hud a, #hud [data-tab]')].find(e => e.offsetParent && (e.textContent || e.getAttribute('title') || '').trim().toLowerCase().startsWith(want)); el?.click(); return !!el; })()`).catch(() => false);
        if (!hit) console.warn(`  [${st.name}] no visible control labelled "${st.click}" yet`);
      }
      await wait(st.settle ?? 900);
      if (st.check && !(await js(page, `(() => { try { return !!(${st.check}); } catch { return false; } })()`).catch(() => false)))
        console.warn(`  [${st.name}] STATE NOT REACHED (check failed): ${st.check}`);
      const file = join(outDir, `${iteration}-${st.name}${w === 1512 ? "" : `-${w}`}.png`);
      await page.screenshot({ path: file });
      saved.push(file);
      console.log(`shoot: ${file.replace(outDir + "/", "")}`);
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`shoot: ${saved.length} shots in docs/shots/look/`);
