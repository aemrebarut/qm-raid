// node shot.mjs <url> <out.png> [w] [h] [waitMs]
import { chromium } from "playwright-core";
const [url, out, w = "1440", h = "900", wait = "4000"] = process.argv.slice(2);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const errs = [];
// ART=on|off|<areas> sets the board's art flag before load
if (process.env.ART) await p.addInitScript((v) => localStorage.setItem("raid.art", v), process.env.ART);
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(url, { waitUntil: "load", timeout: 60000 });
// showroom: wait until exhibits are placed (headless swiftshader is slow), then the extra wait
if (url.includes(":4620")) await p.waitForFunction(() => window.showroom && window.showroom.placed.length > 0, null, { timeout: 60000 }).catch(() => {});
// board: wait until the world is drawn
if (/:46(11|19|21)/.test(url)) await p.waitForFunction(() => window.raidScene && window.raidScene.renderer.info.render.calls > 100, null, { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
console.log(out, errs.length ? "ERRORS:\n" + [...new Set(errs)].slice(0, 8).join("\n") : "no console errors");
await b.close();
