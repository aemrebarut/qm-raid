// A2 flow on the 4619 test board: art on, order the first idle unit onto the nearest open target, shoot while walking and working.
import { chromium } from "playwright-core";
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://127.0.0.1:4619/?art=on", { waitUntil: "load" });
await p.waitForFunction(() => window.raid && window.raid.store && window.raid.store.getState().units.length > 0, null, { timeout: 60000 });
await p.waitForTimeout(6000);
await p.screenshot({ path: "/tmp/a2-0.png" });
const info = await p.evaluate(async () => {
  const s = window.raid.store.getState();
  const u = s.units.find((x) => x.status === "idle") ?? s.units[0];
  const open = s.targets.filter((t) => t.status === "open");
  const t = open.sort((a, b2) => Math.hypot(a.pos.x - u.pos.x, a.pos.y - u.pos.y) - Math.hypot(b2.pos.x - u.pos.x, b2.pos.y - u.pos.y))[0];
  const r = await window.raid.api.order({ unitIds: [u.id], targetId: t.id });
  window.raid.bus.select([u.id]);
  return { unit: u.id, cls: u.class, target: t.id, issue: t.issue, r };
});
console.log(JSON.stringify(info));
await p.waitForTimeout(3000);
await p.screenshot({ path: "/tmp/a2-1.png" });
await p.waitForTimeout(9000);
await p.screenshot({ path: "/tmp/a2-2.png" });
const st = await p.evaluate((id) => window.raid.store.getState().units.find((u) => u.id === id)?.status, info.unit);
console.log("status after 12s:", st);
console.log(errs.length ? "ERRORS:\n" + [...new Set(errs)].slice(0, 8).join("\n") : "no console errors");
await b.close();
