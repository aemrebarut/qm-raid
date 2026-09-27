// Pitch screenshots of the 4619 test board with art on: node pitch.mjs [outDir] (default docs/shots of the repo).
// Whole map with and without the HUD, then close-ups driven through the board's debug handles:
// a unit recalling at the Library, the Forge, and a fight at a camp. Orders go to the 4618 mock engine only.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "/Users/emre/Workspace/qm-raid/docs/shots";
const BOARD = process.env.BOARD ?? "http://127.0.0.1:4619/?art=on";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(BOARD, { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => window.raidScene && window.raidScene.renderer.info.render.calls > 100 && window.raid?.store.getState().units.length > 0, null, { timeout: 90000 });
await p.waitForTimeout(3000);

const hud = (on) => p.evaluate((v) => { const h = document.getElementById("hud"); if (h) h.style.visibility = v ? "" : "hidden"; }, on);
/** Point the iso camera at a tile with a zoom (board camera, same angle). */
const focus = (x, y, zoom) => p.evaluate(([x, y, zoom]) => {
  const iso = window.raidScene.iso;
  iso.target.set(x + 0.5, 0, y + 0.5);
  iso.camera.zoom = zoom;
  iso.camera.updateProjectionMatrix();
  iso.update();
}, [x, y, zoom]);
const shot = async (name) => { await p.screenshot({ path: `${OUT}/${name}.png` }); console.log(`${OUT}/${name}.png`); };

await shot("board-map-hud");
await hud(false);
await shot("board-map");

// Fight: order two idle units onto the nearest open camp, wait until they work, frame the camp.
const fight = await p.evaluate(async () => {
  const s = window.raid.store.getState();
  const idle = s.units.filter((u) => u.status === "idle").slice(0, 2);
  const t = s.targets.filter((x) => x.status === "open").sort((a, c) => c.severity - a.severity)[0];
  if (!idle.length || !t) return null;
  await window.raid.api.order({ unitIds: idle.map((u) => u.id), targetId: t.id });
  return { x: t.pos.x, y: t.pos.y, units: idle.map((u) => u.id) };
});
const lib = await p.evaluate(() => window.raid.store.getState().buildings.find((x) => x.kind === "gbrain"));
if (lib) { await focus(lib.x, lib.y, 2.2); await p.waitForTimeout(2500); await shot("board-library-recall"); }
if (fight) { await p.waitForTimeout(6000); await focus(fight.x, fight.y, 2.4); await p.waitForTimeout(2500); await shot("board-fight"); }
const forge = await p.evaluate(() => window.raid.store.getState().buildings.find((x) => x.kind === "river"));
if (forge) { await focus(forge.x, forge.y, 2.4); await p.waitForTimeout(1500); await shot("board-forge"); }
await hud(true);
if (fight) { await focus(fight.x, fight.y, 1.6); await p.waitForTimeout(1500); await shot("board-fight-hud"); }
console.log(errs.length ? "ERRORS:\n" + [...new Set(errs)].slice(0, 6).join("\n") : "no page errors");
await b.close();
