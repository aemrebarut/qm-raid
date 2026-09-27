// Headless WebGL screenshots with scripted effects (raid-art-fx): opens a page in headless Chrome over CDP,
// waits, runs JS steps (fire an effect), waits, captures PNGs. Real time, so effects are caught mid-flight.
// bun scripts/fxshot.ts <url> <out-prefix> [--w 1440 --h 900 --wait 4000] [--js "<code>" --at <ms after js>]...
// Example (board with art on, recall then capture at 700 ms and 1400 ms):
//   bun scripts/fxshot.ts "http://127.0.0.1:4619/?art=lighting,fx" /tmp/recall \
//     --js "const r=raidScene,u=[...r.units.keys()][0];r.recallFx(u,['billing'],'')" --at 700 --at 1400
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args[0], prefix = args[1];
if (!url || !prefix) { console.error("usage: fxshot.ts <url> <out-prefix> [--js code --at ms ...]"); process.exit(2); }
const opt = (k: string, d: number) => { const i = args.indexOf(k); return i > 0 ? Number(args[i + 1]) : d; };
const W = opt("--w", 1440), H = opt("--h", 900), WAIT = opt("--wait", 4000);
const ci = args.indexOf("--clip"); // --clip x,y,w,h (CSS px): also writes <out>-clip.png at 2x
const clip = ci > 0 ? args[ci + 1].split(",").map(Number) : null;
const steps: { js: string; at: number[] }[] = [];
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--js") steps.push({ js: args[++i], at: [] });
  else if (args[i] === "--at") (steps.at(-1) ?? (steps.push({ js: "", at: [] }), steps[0])).at.push(Number(args[++i]));
}
if (!steps.length) steps.push({ js: "", at: [0] });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "fxshot-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
  `--window-size=${W},${H}`, "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });
const cleanup = () => { try { chrome.kill("SIGKILL"); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  let wsUrl = "";
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch {}
  }
  if (!wsUrl) throw new Error("chrome did not start");
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); } };
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url });
  await sleep(WAIT);
  let n = 0;
  for (const s of steps) {
    const t0 = Date.now();
    if (s.js) {
      const r = await send("Runtime.evaluate", { expression: s.js, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) console.error("js error:", r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
      else if (r.result?.result?.value !== undefined) console.log("js:", JSON.stringify(r.result.result.value));
    }
    for (const at of s.at) {
      const left = at - (Date.now() - t0);
      if (left > 0) await sleep(left);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const out = `${prefix}-${++n}.png`;
      writeFileSync(out, Buffer.from(shot.result.data, "base64"));
      console.log(out);
      if (clip) {
        const c = await send("Page.captureScreenshot", { format: "png", clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 2 } });
        writeFileSync(out.replace(/\.png$/, "-clip.png"), Buffer.from(c.result.data, "base64"));
      }
    }
  }
  const fps = await send("Runtime.evaluate", { expression: "document.getElementById('stats')?.textContent ?? ''", returnByValue: true });
  if (fps.result?.result?.value) console.log("stats:", fps.result.result.value);
  ws.close();
} finally {
  cleanup();
}
process.exit(0);
