// Draw calls, triangles and programs on the 4619 board with ?art=<v> for each argument (default: off on).
import { chromium } from "playwright-core";
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["off", "on"];
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const m of modes) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:4619/?art=${m}`, { waitUntil: "load" });
  await p.waitForFunction(() => window.raidScene && window.raid?.store.getState().units.length > 0, null, { timeout: 60000 });
  await p.waitForTimeout(5000);
  const r = await p.evaluate(() => {
    const i = window.raidScene.renderer.info, s = window.raid.store.getState();
    let meshes = 0; window.raidScene.scene.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isSprite || o.isLine) meshes++; });
    return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs?.length, geometries: i.memory.geometries, textures: i.memory.textures, visibleDrawables: meshes, units: s.units.length, targets: s.targets.length };
  });
  console.log(`art=${m}`, JSON.stringify(r), errs.length ? "ERR " + errs[0] : "");
  await p.close();
}
await b.close();
