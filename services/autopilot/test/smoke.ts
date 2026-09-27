// Smoke test against a running autopilot: bun test/smoke.ts   (AUTOPILOT_URL, default http://127.0.0.1:4613)
const URL_ = process.env.AUTOPILOT_URL ?? "http://127.0.0.1:4613";
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; };
const propose = async (body: unknown) => {
  const r = await fetch(URL_ + "/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

const h = await (await fetch(URL_ + "/health")).json();
check(h.ok === true && h.service === "autopilot", "GET /health");

const unit = (id: string, x: number, y: number, extra = {}) => ({ id, class: "knight", team: 1, status: "idle", pos: { x, y }, history: [], ...extra });
const target = (id: string, component: string, severity: number, x: number, y: number, extra = {}) =>
  ({ id, component, severity, kind: "bug", status: "open", pos: { x, y }, customers: [], ...extra });

// 2 units, 3 targets: 2 proposals on different targets, highest severity first
let r = await propose({ units: [unit("u1", 12, 12), unit("u2", 13, 12)], targets: [target("t1", "billing", 1, 12, 13), target("t2", "auth", 3, 20, 3), target("t3", "search", 2, 3, 12)], memory: "" });
let p = r.body.proposals;
check(r.status === 200 && Array.isArray(p) && p.length === 2, "2 units, 3 targets -> 2 proposals");
check(p[0]?.targetId === "t2" && p[1]?.targetId === "t3" && p[0].unitId !== p[1].unitId, "different targets, highest severity first (t2 sev 3, then t3 sev 2)");
check(typeof p[0]?.reason === "string" && /severity 3 bug in auth, \d+ tiles away/.test(p[0].reason), `reason in plain words: "${p[0]?.reason}"`);

// only idle units and open targets
r = await propose({ units: [unit("u1", 1, 1, { status: "working" }), unit("u2", 1, 1)], targets: [target("t1", "billing", 3, 1, 2, { status: "engaged" }), target("t2", "auth", 1, 9, 9)], memory: "" });
p = r.body.proposals;
check(p.length === 1 && p[0].unitId === "u2" && p[0].targetId === "t2", "skips non-idle units and non-open targets");

// history: same severity, the unit that knows the component gets it even when farther away
r = await propose({ units: [unit("u1", 5, 5), unit("u2", 12, 12, { history: [{ targetId: "t9", component: "billing" }] })], targets: [target("t1", "billing", 2, 6, 6)], memory: "" });
p = r.body.proposals;
check(p.length === 1 && p[0].unitId === "u2" && /knows billing/.test(p[0].reason), "history: unit that knows the component wins");

// memory mention breaks a same-severity tie
r = await propose({ units: [unit("u1", 10, 10)], targets: [target("t1", "billing", 2, 10, 11), target("t2", "search", 2, 10, 11)], memory: "Ada learned that search reindex jobs must be tenant scoped" });
check(r.body.proposals[0]?.targetId === "t2", "memory text mentioning a component adds weight");

// K9: memory naming a rule / learning for a component shows in the reason and adds weight
r = await propose({ units: [unit("u1", 10, 10)], targets: [target("t1", "auth", 3, 10, 12), target("t2", "billing", 3, 10, 12)],
  memory: "Recalling what the team knows about billing and LUM-101\nLinking learnings/lum-101-u1-1790546460000 to rules/billing-idempotency" });
check(r.body.proposals[0]?.targetId === "t2" && /team learned the idempotency rule/.test(r.body.proposals[0]?.reason), `rule in memory: "${r.body.proposals[0]?.reason}"`);
r = await propose({ units: [unit("u1", 10, 10)], targets: [target("t1", "auth", 2, 10, 12)], memory: "Bram remembered learnings/lum-104-u2-1 about auth token expiry" });
check(/team has a learning on auth/.test(r.body.proposals[0]?.reason ?? ""), `learning in memory: "${r.body.proposals[0]?.reason}"`);
r = await propose({ units: [unit("u1", 10, 10)], targets: [target("t1", "search", 2, 10, 12)], memory: "Recalling what the team knows about search and LUM-107" });
check(/recent memory mentions search/.test(r.body.proposals[0]?.reason ?? "") && !/learn/.test(r.body.proposals[0]?.reason ?? ""), `bare mention: "${r.body.proposals[0]?.reason}"`);

// tie-break by lower unit id
r = await propose({ units: [unit("u10", 5, 5), unit("u2", 5, 5)], targets: [target("t1", "billing", 2, 6, 6)], memory: "" });
check(r.body.proposals[0]?.unitId === "u2", "tie-break by lower unit id (u2 before u10)");

// empty and bad input
r = await propose({});
check(r.status === 200 && Array.isArray(r.body.proposals) && r.body.proposals.length === 0, "empty input -> {proposals: []}");
const bad = await fetch(URL_ + "/propose", { method: "POST", body: "not json" });
check(bad.status === 400 && (await bad.json()).ok === false, "bad json -> 400 {ok:false}");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
