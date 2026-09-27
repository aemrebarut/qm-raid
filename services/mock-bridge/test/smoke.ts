// Smoke test against a running mock-bridge: bun test/smoke.ts
// Env: MOCK_URL (default http://127.0.0.1:4615), MOCK_SPEED (must match the server's, default 1).
import type { BridgeEvent } from "../../../contract/types.ts";

const URL_ = process.env.MOCK_URL ?? "http://127.0.0.1:4615";
const SPEED = Number(process.env.MOCK_SPEED ?? 1);
const run = Date.now().toString(36);
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const post = (path: string, body: unknown, method = "POST") =>
  fetch(URL_ + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// collect SSE events with arrival time
const events: Array<{ at: number; ev: BridgeEvent }> = [];
const ac = new AbortController();
const es = await fetch(URL_ + "/events", { signal: ac.signal });
check(es.ok && (es.headers.get("content-type") ?? "").includes("text/event-stream"), "GET /events is an SSE stream");
(async () => {
  const reader = es.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        for (const line of block.split("\n")) if (line.startsWith("data: ")) events.push({ at: Date.now(), ev: JSON.parse(line.slice(6)) });
      }
    }
  } catch { /* aborted */ }
})();

const h = await (await fetch(URL_ + "/health")).json();
check(h.ok === true && h.service === "mock-bridge", "GET /health");

// runtime config (shared mock): deterministic names for the main run, restored at the end
const saved = (await (await fetch(URL_ + "/debug/config")).json()).config;
const setConfig = async (c: object) => (await post("/debug/config", c)).json();
const cfg = await setConfig({ mcpNames: 0, fail: 0, noGbrain: false });
check(cfg.ok === true && cfg.config.mcpNames === 0 && cfg.config.fail === 0 && cfg.config.noGbrain === false, "POST /debug/config -> {ok, config}");

const A = `smokeA-${run}`, B = `smokeB-${run}`, C = `smokeC-${run}`, D = `smokeD-${run}`, E = `smokeE-${run}`;
const F = `smokeF-${run}`, G = `smokeG-${run}`, H = `smokeH-${run}`, I = `smokeI-${run}`, J = `smokeJ-${run}`;
for (const id of [A, B, C, D, E, F, G, H, I, J]) {
  const r = await (await post("/units", { id, name: id, model: "mock", effort: "low", role: "worker", team: 1 })).json();
  if (id === A) check(r.sessionId === `mock-${A}` && r.sessionUrl === null, "POST /units -> {sessionId, sessionUrl}");
}
check((await post("/units", { name: "x" })).status === 400, "POST /units without id -> 400");
check((await post(`/units/${A}/send`, {})).status === 400, "send without text -> 400");
check((await post(`/units/nope-${run}`, { team: 2 }, "PATCH")).status === 404, "PATCH unknown unit -> 404");
check((await (await post(`/units/${A}`, { team: 2 }, "PATCH")).json()).ok === true, "PATCH /units/:id {team}");

// the engine's order prompt (docs/lanes/eng-plan.md), with an engine-assigned learning slug
const learnA = `learnings/lum-12-${A.toLowerCase()}-1790546460000`;
const prompt = (oid: string, learn = "learnings/lum-12-x-1") => `Order ${oid}: work on issue LUM-12 "Retry double-charges a card" (bug, severity 3).
Component: billing
Customers: acme-robotics
GBrain pages: components/billing, issues/lum-12, companies/acme-robotics
Lumen is a synthetic product with no code checkout; GBrain is your only source. 1) Recall first: read the pages above and search GBrain for house rules and past learnings on this component. 2) Decide the fix and say it in 3 to 5 sentences, naming any rule you applied. 3) Remember: write one GBrain page ${learn} (type learning) with what you learned, linking [[components/billing]] and [[issues/lum-12]]. Reply in at most 4 sentences.`;

const t0 = Date.now();
await post(`/units/${A}/send`, { text: prompt("oA", learnA), orderId: "oA", targetId: "t12", componentId: "billing" });
await post(`/units/${B}/send`, { text: "How is it going?" });                    // direct message
await post(`/units/${C}/send`, { text: prompt("oC"), orderId: "oC", componentId: "billing" });
await post(`/units/${D}/send`, { text: prompt("oD1"), orderId: "oD1", componentId: "billing" });
setTimeout(() => post(`/units/${D}/send`, { text: prompt("oD2"), orderId: "oD2", componentId: "billing" }), 500 / SPEED);
await post(`/units/${E}/send`, { text: prompt("oE"), orderId: "oE", componentId: "billing" });
setTimeout(() => post(`/units/${E}/send`, { text: "What is the status of LUM-12? Is the order done?" }), 300 / SPEED); // chat mentioning an issue
// config is read at send time, so each of these orders gets its own mode
await setConfig({ noGbrain: true });
await post(`/units/${F}/send`, { text: prompt("oF"), orderId: "oF", componentId: "billing" });
await setConfig({ noGbrain: false, mcpNames: 1 });
await post(`/units/${G}/send`, { text: prompt("oG"), orderId: "oG", componentId: "billing" });
await setConfig({ mcpNames: 0, fail: 1 });
await post(`/units/${H}/send`, { text: prompt("oH"), orderId: "oH", componentId: "billing" });
// demo story on a component of its own (keeps the shared billing memory clean): wave 1 now, wave 2 after wave 1 replies
const demoComp = `smoke${run}`;
const learnI = `learnings/lum-7-${I.toLowerCase()}-1790546460000`;
const demoPrompt = (oid: string, issue: string, learn: string) => prompt(oid, learn).replace(/LUM-12/g, issue).replace(/billing/g, demoComp);
await setConfig({ fail: 0, script: "demo" });
await post(`/units/${I}/send`, { text: demoPrompt("oI", "LUM-7", learnI), orderId: "oI", componentId: demoComp });
await setConfig({ speed: saved.speed, fail: saved.fail, noGbrain: saved.noGbrain, mcpNames: saved.mcpNames, script: saved.script });
let jSent = false;
const sendJ = async () => {
  jSent = true;
  await setConfig({ script: "demo", fail: 0, noGbrain: false });
  await post(`/units/${J}/send`, { text: demoPrompt("oJ", "LUM-8", `learnings/lum-8-${J.toLowerCase()}-1790546470000`), orderId: "oJ", componentId: demoComp });
  await setConfig({ fail: saved.fail, noGbrain: saved.noGbrain, script: saved.script });
};
let cDeletedAt = 0;
setTimeout(async () => { await fetch(`${URL_}/units/${C}`, { method: "DELETE" }); cDeletedAt = Date.now(); }, 1500 / SPEED);

const deadline = Date.now() + 12000 / SPEED + 1000;
const done = (id: string) => events.some((e) => e.ev.unitId === id && (e.ev.type === "reply" || e.ev.type === "error"));
const orderDone = (id: string, oid: string) => events.some((e) => e.ev.unitId === id && e.ev.type === "reply" && (e.ev as any).orderId === oid);
const deadline2 = deadline + 8000 / SPEED;
while (Date.now() < deadline2 && !(done(A) && done(B) && orderDone(D, "oD2") && orderDone(E, "oE") && done(F) && done(G) && done(H) && done(J))) {
  if (!jSent && done(I)) await sendJ();
  await Bun.sleep(100);
}
await Bun.sleep(1000 / SPEED); // let stragglers arrive

const of = (id: string) => events.filter((e) => e.ev.unitId === id).map((e) => e.ev);
const a = of(A);
const idx = (pred: (e: BridgeEvent) => boolean) => a.findIndex(pred);
const recall = a.find((e) => e.type === "activity" && e.tool === "gbrain.recall") as any;
const remember = a.find((e) => e.type === "activity" && e.tool === "gbrain.remember") as any;
const replyAt = events.find((e) => e.ev.unitId === A && e.ev.type === "reply")?.at ?? 0;
check(a[0]?.type === "activity" && (a[0] as any).kind === "thinking", "order starts with thinking");
check(!!recall && ["components/billing", "rules/billing-idempotency", "issues/lum-12", "companies/acme-robotics"].every((s) => recall.args?.slugs?.includes(s)), "gbrain.recall {query, slugs} with contract slugs and the world rule page");
check(!!remember && remember.args?.slug === learnA && typeof remember.args?.text === "string" && Array.isArray(remember.args?.links), "gbrain.remember {slug, text, links} uses the engine-assigned learning slug");
check(idx((e) => e.type === "activity" && e.tool === "gbrain.recall") < idx((e) => e.type === "activity" && e.tool === "gbrain.remember"), "recall before remember");
check(a.at(-1)?.type === "reply" && a.some((e) => e.type === "usage"), "usage, then reply last");
check(a.filter((e) => e.type !== "usage").every((e) => (e as any).orderId === "oA"), "every activity and reply carries orderId");
const secs = (replyAt - t0) / 1000;
check(replyAt > 0 && secs >= 5.7 / SPEED && secs <= 10.5 / SPEED, `reply after ${secs.toFixed(1)} s (6 to 10 s at speed 1)`);
const b = of(B);
check(b.at(-1)?.type === "reply" && b.every((e) => (e as any).orderId === undefined) && !b.some((e) => (e as any).tool === "gbrain.recall"), "direct message: short chat, no orderId");
check(events.filter((e) => e.ev.unitId === C && e.at > cDeletedAt + 50).length === 0 && cDeletedAt > 0, "DELETE stops a unit's script");
const d = of(D);
check(!d.some((e) => (e.type === "reply" || e.type === "error") && (e as any).orderId === "oD1") && d.some((e) => e.type === "reply" && (e as any).orderId === "oD2"), "new order supersedes the running one");
check([...b, ...d].every((e) => (e as any).orderId !== "oA") && a.every((e) => [undefined, "oA"].includes((e as any).orderId)), "isolation: no orderId leaks across units");

const e = of(E);
check(orderDone(E, "oE") && e.some((x) => x.type === "reply" && (x as any).orderId === undefined), "chat mentioning an issue does not cancel the running order (both replies arrive)");

const f = of(F);
check(orderDone(F, "oF") && !f.some((x) => x.type === "activity" && /gbrain/.test(x.tool ?? "")), "noGbrain: order completes with no gbrain tool calls");
const g = of(G);
check(g.some((x) => x.type === "activity" && x.tool === "mcp__gbrain__search") && g.some((x) => x.type === "activity" && x.tool === "mcp__gbrain__put_page") && !g.some((x) => x.type === "activity" && x.tool?.startsWith("gbrain.")), "mcpNames: mcp__gbrain__search / mcp__gbrain__put_page");
const hh = of(H);
check(hh.at(-1)?.type === "error" && (hh.at(-1) as any).orderId === "oH" && !hh.some((x) => x.type === "reply") && hh.some((x) => x.type === "activity" && x.kind === "error"), "fail: activity kind error, then terminal error with orderId, no reply");
const iEv = of(I), jEv = of(J);
const tool = (evs: BridgeEvent[], name: string) => evs.find((x) => x.type === "activity" && x.tool === name) as any;
check(iEv.some((x) => x.type === "activity" && /First attempt fails/.test(x.text)) && tool(iEv, "gbrain.remember")?.args?.slug === learnI && !tool(iEv, "gbrain.recall")?.args?.slugs?.some((s: string) => s.startsWith("learnings/")), "demo wave 1: no learning recalled, first attempt fails, remembers the rule");
check(!!tool(jEv, "gbrain.recall")?.args?.slugs?.includes(learnI) && tool(jEv, "gbrain.get_page")?.args?.slug === learnI && (jEv.at(-1) as any)?.text?.includes(learnI), "demo wave 2: recalls wave 1's exact learning slug and quotes it in the reply");
const restored = (await (await fetch(URL_ + "/debug/config")).json()).config;
check(JSON.stringify(restored) === JSON.stringify(saved), "config restored");

for (const id of [A, B, D, E, F, G, H, I, J]) await fetch(`${URL_}/units/${id}`, { method: "DELETE" });
ac.abort();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
