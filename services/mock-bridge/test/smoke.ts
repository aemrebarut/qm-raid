// Smoke test against a running mock-bridge: bun test/smoke.ts
// Env: MOCK_URL (default http://127.0.0.1:4615), MOCK_SPEED (default: the server's speed from GET /debug/config).
import type { BridgeEvent } from "../../../contract/types.ts";

const URL_ = process.env.MOCK_URL ?? "http://127.0.0.1:4615";
const serverSpeed = await fetch(URL_ + "/debug/config").then((r) => r.json()).then((d) => d?.config?.speed).catch(() => undefined);
const SPEED = Number(process.env.MOCK_SPEED ?? serverSpeed ?? 1);
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
// team workflows (K12): engine prompt + "Role: <role>. <instructions>" + "Previous work:" (latest last), as game.ts briefText
const K = `smokeK-${run}`, L = `smokeL-${run}`, M = `smokeM-${run}`, N = `smokeN-${run}`, O = `smokeO-${run}`;
const REVIEW = "Role: reviewer. Recall the house rules. Review the implementation against the plan and the rules. End with VERDICT: APPROVED or VERDICT: CHANGES: <what>.";
const IMPL = "Role: implementer. Recall first. Implement the plan or apply the review changes; remember what you learned.";
const flow = (oid: string, role: string, previous: string[]) => `${prompt(oid)}\n\n${role}${previous.length ? `\nPrevious work:\n${previous.join("\n")}` : ""}`;
const pPlan = `- planner (${K}): ${K}: plan for LUM-12:\n1. Reproduce.\n2. Fix.\n3. Test.`;
const pImpl = `- implementer (${M}): ${M}: fixed LUM-12.`;
const pChanges = `- reviewer (${L}): ${L}: reviewed LUM-12.\nVERDICT: CHANGES: add a retry test with the same inv_1 key`;
await post(`/units/${K}/send`, { text: flow("oK", "Role: planner. Recall first. Write a short numbered plan for the implementer; do not implement.", []), orderId: "oK", targetId: "t12", componentId: "billing" });
await post(`/units/${L}/send`, { text: flow("oL", REVIEW, [pPlan, pImpl]), orderId: "oL", targetId: "t12", componentId: "billing" });
await post(`/units/${M}/send`, { text: flow("oM", IMPL, [pPlan, pImpl, pChanges]), orderId: "oM", targetId: "t12", componentId: "billing" });
await post(`/units/${N}/send`, { text: flow("oN", REVIEW, [pPlan, pImpl, pChanges, pImpl]), orderId: "oN", targetId: "t12", componentId: "billing" });
await setConfig({ review: "changes" });
await post(`/units/${O}/send`, { text: flow("oO", REVIEW, [pPlan, pImpl, pChanges, pImpl]), orderId: "oO", targetId: "t12", componentId: "billing" });
await setConfig({ review: saved.review ?? "loop" });
// loadout: catalog, PATCH merge and validation, marker activity; T asks for no plugins, but GBrain is locked on
const T = `smokeT-${run}`;
const catalog = (await (await fetch(URL_ + "/catalog")).json()).items as Array<{ id: string; kind: string; name: string; description: string }>;
const ALLOW = "raid-board,memory,miniapp,popular-web-designs,taste-skill";
check(Array.isArray(catalog) && catalog.filter((c) => c.kind === "skill").map((c) => c.id).join(",") === ALLOW && catalog.filter((c) => c.kind === "plugin").map((c) => c.id).join(",") === "gbrain" && catalog.some((c) => c.id === "gbrain" && c.description.startsWith("The Library: always on.")) && catalog.every((c) => c.id && c.name && c.description), `GET /catalog: ${catalog?.map((c) => c.id).join(", ")}; only the qm-bridge skill allowlist, gbrain the only plugin, marked always on`);
await post("/units", { id: T, name: T, model: "mock", effort: "low", role: "worker", team: 1 });
const lo1 = await (await post(`/units/${T}`, { loadout: { instructions: "Always write the regression test first.", skills: ["raid-board", "memory"], plugins: [] }, model: "gpt-6-sol", effort: "high" }, "PATCH")).json();
const lo2 = await post(`/units/${T}`, { loadout: { skills: ["send"] } }, "PATCH");
const lo3 = await post(`/units/${T}`, { loadout: { plugins: ["github"] } }, "PATCH");
const tView = await (await fetch(`${URL_}/units/${T}`)).json();
check(lo1.ok === true && lo1.applied === "live" && lo1.loadout?.skills?.join(",") === "raid-board,memory" && lo1.loadout?.plugins?.join(",") === "gbrain" && lo1.model === "gpt-6-sol" && lo1.effort === "high" && lo2.status === 400 && lo3.status === 400 && tView.loadout?.skills?.length === 2, "PATCH /units/:id {loadout, model, effort} -> {ok, loadout, model, effort, applied}; plugins [] keeps GBrain; a skill or plugin outside the allowlist -> 400");
await post(`/units/${T}/send`, { text: prompt("oT"), orderId: "oT", targetId: "t12", componentId: "billing" });
// more presets (recon, testfirst, herald, duel): scout, tester, herald, judge
const P = `smokeP-${run}`, Q = `smokeQ-${run}`, R = `smokeR-${run}`, S = `smokeS-${run}`;
const pDuel = [`- implementer (${M}): ${M}: fixed LUM-12. I made the retry reuse inv_<invoiceId>, added a regression test, and saved learnings/lum-12-x-1.`, `- implementer (${N}): ${N}: fixed LUM-12.\nI patched the retry loop.`];
await post(`/units/${P}/send`, { text: flow("oP", "Role: scout. Recall first. Investigate only: reproduce, point to the code, list the house rules and past learnings that apply. Do not fix.", []), orderId: "oP", targetId: "t12", componentId: "billing" });
await post(`/units/${Q}/send`, { text: flow("oQ", "Role: tester. Recall first. Write the failing regression test and the exact acceptance check. Do not fix.", []), orderId: "oQ", targetId: "t12", componentId: "billing" });
await post(`/units/${R}/send`, { text: flow("oR", "Role: herald. Write the customer update for the affected customers in the house tone: what broke, what we fixed, what they need to do.", [pImpl, `- reviewer (${L}): ${L}: fine.\nVERDICT: APPROVED`]), orderId: "oR", targetId: "t12", componentId: "billing" });
await post(`/units/${S}/send`, { text: flow("oS", "Role: judge. Compare both fixes against the house rules. Pick the better one, say why in two lines, and end with VERDICT: APPROVED (winner: <name>) or VERDICT: CHANGES: <what> if neither is acceptable.", pDuel), orderId: "oS", targetId: "t12", componentId: "billing" });
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
  await setConfig({ script: "demo", fail: 0, noGbrain: false, mcpNames: 0 });
  await post(`/units/${J}/send`, { text: demoPrompt("oJ", "LUM-8", `learnings/lum-8-${J.toLowerCase()}-1790546470000`), orderId: "oJ", componentId: demoComp });
  await setConfig({ fail: saved.fail, noGbrain: saved.noGbrain, mcpNames: saved.mcpNames, script: saved.script });
};
let cDeletedAt = 0;
setTimeout(async () => { await fetch(`${URL_}/units/${C}`, { method: "DELETE" }); cDeletedAt = Date.now(); }, 1500 / SPEED);

const deadline = Date.now() + 12000 / SPEED + 1000;
const done = (id: string) => events.some((e) => e.ev.unitId === id && (e.ev.type === "reply" || e.ev.type === "error"));
const orderDone = (id: string, oid: string) => events.some((e) => e.ev.unitId === id && e.ev.type === "reply" && (e.ev as any).orderId === oid);
const deadline2 = deadline + 8000 / SPEED;
while (Date.now() < deadline2 && !(done(A) && done(B) && orderDone(D, "oD2") && orderDone(E, "oE") && done(F) && done(G) && done(H) && done(J) && [K, L, M, N, O, P, Q, R, S, T].every(done))) {
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
// accepts the MCP aliases too (mcp__gbrain__search for recall/search, mcp__gbrain__put_page for remember)
const ALIAS: Record<string, string> = { "gbrain.recall": "mcp__gbrain__search", "gbrain.search": "mcp__gbrain__search", "gbrain.get_page": "mcp__gbrain__get_page", "gbrain.remember": "mcp__gbrain__put_page" };
const tool = (evs: BridgeEvent[], name: string) => evs.find((x) => x.type === "activity" && (x.tool === name || x.tool === ALIAS[name])) as any;
check(iEv.some((x) => x.type === "activity" && /First attempt fails/.test(x.text)) && tool(iEv, "gbrain.remember")?.args?.slug === learnI && !tool(iEv, "gbrain.recall")?.args?.slugs?.some((s: string) => s.startsWith("learnings/")), "demo wave 1: no learning recalled, first attempt fails, remembers the rule");
check(!!tool(jEv, "gbrain.recall")?.args?.slugs?.includes(learnI) && tool(jEv, "gbrain.get_page")?.args?.slug === learnI && (jEv.at(-1) as any)?.text?.includes(learnI), "demo wave 2: recalls wave 1's exact learning slug and quotes it in the reply");
const replyOf = (id: string) => (of(id).find((x) => x.type === "reply") as any)?.text as string | undefined;
const lastLine = (t?: string) => t?.trim().split("\n").at(-1) ?? "";
const kEv = of(K), kReply = replyOf(K);
check(!!kReply && /\n1\. .+\n2\. .+\n3\. .+$/.test(kReply) && !kEv.some((x) => x.type === "activity" && ["edit_file", "gbrain.remember"].includes(x.tool ?? "")) && kEv.every((x) => x.type === "usage" || (x as any).orderId === "oK"), "workflow planner: 3-step numbered plan, no edits, no remember");
check(/^VERDICT: CHANGES: \S.+/.test(lastLine(replyOf(L))) && of(L).some((x) => x.type === "activity" && x.tool === "gbrain.recall"), `workflow reviewer, first review: ${lastLine(replyOf(L))}`);
check(lastLine(replyOf(N)) === "VERDICT: APPROVED", "workflow reviewer, second review (a verdict in the previous work): VERDICT: APPROVED");
const mReply = replyOf(M) ?? "";
check(!/VERDICT:/.test(mReply) && mReply.includes("add a retry test with the same inv_1 key") && of(M).some((x) => x.type === "activity" && x.tool === "gbrain.remember"), "workflow implementer with the reviewer's CHANGES in its previous work is not a reviewer and applies the change");
check(/^VERDICT: CHANGES: /.test(lastLine(replyOf(O))), "review: changes forces VERDICT: CHANGES (needs_human tests)");
const pEv = of(P), qEv = of(Q), rReply = replyOf(R) ?? "", sReply = replyOf(S) ?? "";
check(/recon for LUM-12/.test(replyOf(P) ?? "") && /rules\/billing-idempotency/.test(replyOf(P) ?? "") && !pEv.some((x) => x.type === "activity" && x.tool === "edit_file") && pEv.some((x) => x.type === "activity" && x.tool === "run_tests"), "workflow scout: reproduces, names the code and rules, no edits");
check(/failing test for LUM-12/.test(replyOf(Q) ?? "") && /Acceptance check: /.test(replyOf(Q) ?? "") && qEv.some((x) => x.type === "activity" && x.tool === "edit_file" && /test/.test((x as any).args?.path ?? "")) && !qEv.some((x) => x.type === "activity" && x.tool === "edit_file" && !/test/.test((x as any).args?.path ?? "")), "workflow tester: failing test and acceptance check, edits only the test file");
check(rReply.startsWith("Subject: Fixed: ") && /Acme Robotics/.test(rReply) && /What broke: /.test(rReply) && /What we fixed: /.test(rReply) && /What you need to do: /.test(rReply) && !/VERDICT/.test(rReply) && of(R).some((x) => x.type === "activity" && x.tool === "gbrain.get_page" && (x as any).args?.slug === "companies/acme-robotics"), "workflow herald: customer update (what broke, what we fixed, what to do), reads the company page");
check(lastLine(sReply) === `VERDICT: APPROVED (winner: ${M})` && sReply.includes(N), `workflow judge: ${lastLine(sReply)}`);
const tEv = of(T);
check(tEv.some((x) => x.type === "activity" && /^Loadout changed: model gpt-6-sol \(high\); skills: raid-board, memory; plugins: GBrain; standing orders/.test(x.text) && (x as any).orderId === undefined), "loadout change emits the 'Loadout changed' marker activity");
check(orderDone(T, "oT") && tEv.some((x) => x.type === "activity" && /gbrain/.test(x.tool ?? "")) && tEv.some((x) => x.type === "activity" && (x as any).orderId === "oT" && /^Loadout: skills raid-board, memory; standing orders "Always write/.test(x.text)), "GBrain locked on: the order still recalls and remembers, and opens with the loadout note");
const restored = (await (await fetch(URL_ + "/debug/config")).json()).config;
check(JSON.stringify(restored) === JSON.stringify(saved), "config restored");

for (const id of [A, B, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T]) await fetch(`${URL_}/units/${id}`, { method: "DELETE" });
ac.abort();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
