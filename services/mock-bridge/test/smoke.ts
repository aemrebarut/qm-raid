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

const A = `smokeA-${run}`, B = `smokeB-${run}`, C = `smokeC-${run}`, D = `smokeD-${run}`, E = `smokeE-${run}`;
for (const id of [A, B, C, D, E]) {
  const r = await (await post("/units", { id, name: id, model: "mock", effort: "low", role: "worker", team: 1 })).json();
  if (id === A) check(r.sessionId === `mock-${A}` && r.sessionUrl === null, "POST /units -> {sessionId, sessionUrl}");
}
check((await post("/units", { name: "x" })).status === 400, "POST /units without id -> 400");
check((await post(`/units/${A}/send`, {})).status === 400, "send without text -> 400");
check((await post(`/units/nope-${run}`, { team: 2 }, "PATCH")).status === 404, "PATCH unknown unit -> 404");
check((await (await post(`/units/${A}`, { team: 2 }, "PATCH")).json()).ok === true, "PATCH /units/:id {team}");

const prompt = (oid: string) => `Order ${oid}: work on issue LUM-12 "Retry double-charges a card" (bug, severity 3).
Component: billing
Customers: acme-robotics
GBrain pages: components/billing, issues/lum-12, companies/acme-robotics
First recall from GBrain what we know about this component, issue and customers. Do the work. Then remember what you learned in GBrain (one learning page, linked to the component and issue). End with a short reply.`;

const t0 = Date.now();
await post(`/units/${A}/send`, { text: prompt("oA"), orderId: "oA", targetId: "t12", componentId: "billing" });
await post(`/units/${B}/send`, { text: "How is it going?" });                    // direct message
await post(`/units/${C}/send`, { text: prompt("oC"), orderId: "oC", componentId: "billing" });
await post(`/units/${D}/send`, { text: prompt("oD1"), orderId: "oD1", componentId: "billing" });
setTimeout(() => post(`/units/${D}/send`, { text: prompt("oD2"), orderId: "oD2", componentId: "billing" }), 500 / SPEED);
await post(`/units/${E}/send`, { text: prompt("oE"), orderId: "oE", componentId: "billing" });
setTimeout(() => post(`/units/${E}/send`, { text: "What is the status of LUM-12? Is the order done?" }), 300 / SPEED); // chat mentioning an issue
let cDeletedAt = 0;
setTimeout(async () => { await fetch(`${URL_}/units/${C}`, { method: "DELETE" }); cDeletedAt = Date.now(); }, 1500 / SPEED);

const deadline = Date.now() + 12000 / SPEED + 1000;
const done = (id: string) => events.some((e) => e.ev.unitId === id && (e.ev.type === "reply" || e.ev.type === "error"));
const orderDone = (id: string, oid: string) => events.some((e) => e.ev.unitId === id && e.ev.type === "reply" && (e.ev as any).orderId === oid);
while (Date.now() < deadline && !(done(A) && done(B) && orderDone(D, "oD2") && orderDone(E, "oE"))) await Bun.sleep(100);
await Bun.sleep(1000 / SPEED); // let stragglers arrive

const of = (id: string) => events.filter((e) => e.ev.unitId === id).map((e) => e.ev);
const a = of(A);
const idx = (pred: (e: BridgeEvent) => boolean) => a.findIndex(pred);
const recall = a.find((e) => e.type === "activity" && e.tool === "gbrain.recall") as any;
const remember = a.find((e) => e.type === "activity" && e.tool === "gbrain.remember") as any;
const replyAt = events.find((e) => e.ev.unitId === A && e.ev.type === "reply")?.at ?? 0;
check(a[0]?.type === "activity" && (a[0] as any).kind === "thinking", "order starts with thinking");
check(!!recall && ["components/billing", "rules/billing-idempotency", "issues/lum-12", "companies/acme-robotics"].every((s) => recall.args?.slugs?.includes(s)), "gbrain.recall {query, slugs} with contract slugs and the world rule page");
check(!!remember && new RegExp(`^learnings/lum-12-${A.toLowerCase()}-\\d+$`).test(remember.args?.slug) && typeof remember.args?.text === "string" && Array.isArray(remember.args?.links), "gbrain.remember {slug: learnings/<issue>-<unit>-<ms>, text, links}");
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

for (const id of [A, B, D, E]) await fetch(`${URL_}/units/${id}`, { method: "DELETE" });
ac.abort();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
