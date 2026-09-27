// Workflow live check on the TEST engine (4618, mock backend), owner raid-eng-flow. Never point it at 4610 (real QM).
//   /tmp/engplan/with4618 raid-eng-flow bun test/workflow.e2e.ts [--cases trio,needs_human,cancel,duel,autopilot] [--speed 8] [--timeout 120] [--no-reset]
// 4618 runs the last committed engine: commit first. POST /api/reset (4618 has BRAIN_RESET=0), then per case on team 1:
// - trio: planner -> implementer -> reviewer (changes) -> implementer -> reviewer (approved) -> done, 5 workflow orders,
//   4 handoffs between the right units, target resolved only after the last step.
// - needs_human: mock review "changes": 3 CHANGES (maxLoops 2) -> needs_human, target open, no active orders.
// - cancel: cancelling the implementer's order cancels the run and reopens the target.
// - duel: both implementers start at once, the judge waits for both, then (mock) changes once and approves a winner.
// - autopilot (W3, opt-in until game.ts has it; needs the proposer on 4613): autopilot on for the trio team proposes one
//   team order for the entry unit only; go turns that order into the planner step; the run ends done; the veto log row
//   (--veto-log, default /tmp/engplan/vetoes-test.jsonl, the 4618 VETO_LOG) has proposal.teamId and runId.
// Fails fast when the engine reloads mid-test (SSE drops or a second snapshot) and after --timeout seconds overall.
// The shared mock config is restored at the end. Env: ENGINE_URL (http://127.0.0.1:4618), MOCK_URL (http://127.0.0.1:4615).
const E = (process.env.ENGINE_URL ?? "http://127.0.0.1:4618").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:4615").replace(/\/$/, "");
const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? dflt : dflt; };
const CASES = arg("--cases", "trio,needs_human,cancel,duel").split(",").map((c) => c.trim()).filter(Boolean);
const SPEED = Number(arg("--speed", "8")) || 8;
const TIMEOUT_MS = (Number(arg("--timeout", "120")) || 120) * 1000;
const RESET = !process.argv.includes("--no-reset");
const VETO_LOG = arg("--veto-log", "/tmp/engplan/vetoes-test.jsonl");
if (new URL(E).port === "4610") { console.error("refusing to run against 4610 (the real QM engine); use the test engine on 4618"); process.exit(2); }

const H = { "content-type": "application/json" };
async function call(url: string, method = "GET", body?: unknown): Promise<{ s: number; d: any }> {
  try {
    const r = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return { s: r.status, d: await r.json().catch(() => null) };
  } catch { return { s: 0, d: null }; }
}

let failures = 0;
function check(ok: boolean, what: string, detail: unknown = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || detail === "" ? "" : `: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

const mockBefore = (await call(`${MOCK}/debug/config`)).d?.config;
async function restoreMock(): Promise<void> {
  if (mockBefore) await call(`${MOCK}/debug/config`, "POST", { speed: mockBefore.speed, fail: mockBefore.fail, review: mockBefore.review });
}
// Hard stop: never hold the 4618 lock longer than the budget.
const watchdog = setTimeout(async () => {
  console.log(`FAIL overall timeout (${TIMEOUT_MS / 1000} s)`);
  await restoreMock();
  if (CASES.includes("autopilot")) await call(`${E}/api/teams/1`, "PATCH", { autopilot: false });
  process.exit(1);
}, TIMEOUT_MS);

// ---- engine SSE: a dropped stream or a second snapshot means the engine reloaded and lost its runs ----
const events: any[] = [];
const ctl = new AbortController();
let reloaded = "";
async function listen(): Promise<void> {
  try {
    const r = await fetch(`${E}/api/events`, { signal: ctl.signal });
    const rd = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const blk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = blk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        let ev: any;
        try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === "state.snapshot" && events.some((e) => e.type === "state.snapshot")) reloaded ||= "second state.snapshot (engine reset or reloaded)";
        events.push(ev);
      }
    }
  } catch {}
  if (!ctl.signal.aborted) reloaded ||= "SSE stream closed (engine reloaded)";
}
async function until<T>(pick: () => T | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end && !reloaded) {
    const v = pick();
    if (v !== undefined) return v;
    await Bun.sleep(200);
  }
  return pick();
}
const state = async () => (await call(`${E}/api/state`)).d;
const openTarget = async () => (await state()).targets.find((t: any) => t.status === "open");
const runEnd = (id: string, ms: number) => until(() => events.filter((e) => e.type === "workflow.updated" && e.run.id === id && e.run.status !== "running").pop()?.run, ms);
async function startTeamRun(preset: string): Promise<{ runId: string; target: any; run: any } | null> {
  const put = await call(`${E}/api/teams/1/workflow`, "PUT", { preset });
  check(put.d?.ok === true && put.d.team?.workflow?.preset === preset, `PUT ${preset} preset`, put.d);
  const target = await openTarget();
  const res = await call(`${E}/api/orders`, "POST", { teamId: 1, targetId: target?.id });
  const runId = res.d?.run?.id;
  check(res.d?.ok === true && typeof runId === "string", `${preset}: team order starts a run`, res.d);
  if (typeof runId !== "string") return null;
  console.log(`${preset}: run ${runId} on ${target.id} (${target.issue})`);
  return { runId, target, run: res.d.run };
}
const steps = (run: any) => run.steps.map((s: any) => `${s.nodeId}:${s.status}:${s.unitId}`);
// When a run ends unexpectedly: what else happened to its units meanwhile (another order, a team change, a retire).
function explain(runId: string, unitIds: string[]): void {
  const from = events.findIndex((e) => e.type === "workflow.updated" && e.run.id === runId);
  for (const e of events.slice(Math.max(0, from))) {
    const uid = e.order?.unitId ?? e.unitId ?? e.unit?.id;
    if (["order.updated", "order.proposed", "team.updated", "unit.retired"].includes(e.type) && (e.type === "team.updated" || unitIds.includes(uid)))
      console.log(`   ${e.type} ${JSON.stringify(e.order ?? e.team ?? { unitId: e.unitId })}`);
  }
}
const handoffs = (runId: string) => events.filter((e) => e.type === "workflow.handoff" && e.runId === runId).map((e) => `${e.fromUnitId}>${e.toUnitId}:${e.nodeId}`);

async function trio(m: string[]): Promise<void> {
  const [planner, implementer, reviewer] = m;
  const s = await startTeamRun("trio");
  if (!s) return;
  const final = await runEnd(s.runId, 60000);
  check(final?.status === "done", "trio: run done", final && `${final.status} ${steps(final).join(" ")}`);
  if (final?.status !== "done") explain(s.runId, m);
  if (!final) return;
  check(final.loops === 1, "trio: one changes loop", final.loops);
  check(JSON.stringify(steps(final)) === JSON.stringify([`planner:done:${planner}`, `implementer:done:${implementer}`, `reviewer:changes:${reviewer}`, `implementer:done:${implementer}`, `reviewer:approved:${reviewer}`]), "trio: planner, implementer, reviewer (changes), implementer, reviewer (approved)", steps(final));
  check(JSON.stringify(handoffs(s.runId)) === JSON.stringify([`${planner}>${implementer}:implementer`, `${implementer}>${reviewer}:reviewer`, `${reviewer}>${implementer}:implementer`, `${implementer}>${reviewer}:reviewer`]), "trio: 4 handoffs between the right units", handoffs(s.runId));
  const st = await state();
  const orders = st.orders.filter((o: any) => o.runId === s.runId);
  check(orders.length === 5 && orders.every((o: any) => o.source === "workflow" && o.status === "done"), "trio: 5 done orders with source workflow and runId", orders.map((o: any) => `${o.id}:${o.status}`));
  check(st.targets.find((t: any) => t.id === s.target.id)?.status === "resolved", "trio: target resolved");
  const resolvedAt = events.findIndex((e) => e.type === "target.updated" && e.target.id === s.target.id && e.target.status === "resolved");
  const lastStepDoneAt = events.findLastIndex((e) => e.type === "order.updated" && e.order.runId === s.runId && e.order.status === "done");
  check(resolvedAt > lastStepDoneAt && resolvedAt >= 0, "trio: target resolved only after the last step", { resolvedAt, lastStepDoneAt });
  check(st.workflowRuns.some((r: any) => r.id === s.runId && r.status === "done"), "trio: state.workflowRuns holds the run");
}

async function needsHuman(): Promise<void> {
  await call(`${MOCK}/debug/config`, "POST", { review: "changes" });
  try {
    const s = await startTeamRun("trio");
    if (!s) return;
    const end = await runEnd(s.runId, 60000);
    check(end?.status === "needs_human" && end?.loops === 3, "needs_human: after 3 CHANGES (maxLoops 2)", end && { status: end.status, loops: end.loops });
    const st = await state();
    check(st.targets.find((t: any) => t.id === s.target.id)?.status === "open", "needs_human: target open again");
    check(!st.orders.some((o: any) => o.runId === s.runId && o.status === "active"), "needs_human: no active orders left");
  } finally {
    await call(`${MOCK}/debug/config`, "POST", { review: "loop" });
  }
}

async function cancel(): Promise<void> {
  const s = await startTeamRun("trio");
  if (!s) return;
  const impl = await until(() => events.find((e) => e.type === "order.updated" && e.order.runId === s.runId && e.order.nodeId === "implementer" && e.order.status === "active")?.order, 30000);
  check(!!impl, "cancel: implementer step started");
  if (!impl) return;
  const c = await call(`${E}/api/orders/${impl.id}/cancel`, "POST", {});
  check(c.d?.ok === true, "cancel: POST /api/orders/:id/cancel", c.d);
  const end = await runEnd(s.runId, 5000);
  check(end?.status === "cancelled", "cancel: run cancelled", end?.status);
  await Bun.sleep(2000); // a late mock reply for the cancelled order must change nothing
  const st = await state();
  check(st.targets.find((t: any) => t.id === s.target.id)?.status === "open", "cancel: target open again");
  check(st.workflowRuns.find((r: any) => r.id === s.runId)?.status === "cancelled" && !st.orders.some((o: any) => o.runId === s.runId && o.status === "active"), "cancel: run stays cancelled, no active orders");
}

async function duel(m: string[]): Promise<void> {
  const [a, b, judge] = m;
  const s = await startTeamRun("duel");
  if (!s) return;
  // The POST answer carries the run as it was right after startRun.
  check(JSON.stringify([...(s.run.active ?? [])].sort()) === JSON.stringify(["implementer1", "implementer2"]), "duel: both implementers start at once", s.run.active);
  const final = await runEnd(s.runId, 60000);
  check(final?.status === "done", "duel: run done", final && steps(final));
  if (!final) return;
  const judged = final.steps.filter((x: any) => x.nodeId === "judge");
  check(judged.length >= 1 && judged.at(-1).status === "approved" && judged.at(-1).unitId === judge, "duel: the judge approves last", steps(final));
  // The judge never starts before both implementers of its round finished.
  let ok = true;
  const seen: Record<string, number> = {};
  for (const x of final.steps) {
    if (x.nodeId === "judge") { if ((seen.implementer1 ?? 0) !== (seen.implementer2 ?? 0) || !seen.implementer1) ok = false; }
    else seen[x.nodeId] = (seen[x.nodeId] ?? 0) + 1;
  }
  check(ok, "duel: the judge waits for both implementers every round", steps(final));
  const toJudge = handoffs(s.runId).filter((h) => h.endsWith(":judge"));
  check(toJudge.length === 2 * judged.length && toJudge.every((h) => h.startsWith(`${a}>`) || h.startsWith(`${b}>`)), "duel: a handoff from each implementer to the judge per round", toJudge);
  check((await state()).targets.find((t: any) => t.id === s.target.id)?.status === "resolved", "duel: target resolved");
}

async function autopilot(m: string[]): Promise<void> {
  const put = await call(`${E}/api/teams/1/workflow`, "PUT", { preset: "trio" });
  check(put.d?.ok === true, "autopilot: PUT trio preset", put.d);
  const entry = put.d?.team?.workflow?.nodes?.find((n: any) => n.id === put.d.team.workflow.entry)?.unitId;
  const from = events.length;
  const on = await call(`${E}/api/teams/1`, "PATCH", { autopilot: true });
  check(on.d?.team?.autopilot === true, "autopilot: on for team 1", on.d);
  let p: any;
  try {
    p = await until(() => events.slice(from).find((e) => e.type === "order.proposed" && e.order.teamId === 1)?.order, 30000);
  } finally {
    await call(`${E}/api/teams/1`, "PATCH", { autopilot: false });
  }
  check(!!p, "autopilot: team proposal (order.proposed with teamId 1)", events.slice(from).filter((e) => e.type === "order.proposed").map((e) => e.order));
  if (!p) return;
  check(p.unitId === entry && p.source === "autopilot", "autopilot: proposal binds the entry unit only", { unitId: p.unitId, entry, source: p.source });
  const others = events.slice(from).filter((e) => e.type === "order.proposed" && m.includes(e.order.unitId) && e.order.id !== p.id);
  check(others.length === 0, "autopilot: no other proposals for team 1 members", others.map((e) => e.order));
  const g = await call(`${E}/api/orders/${p.id}/go`, "POST", {});
  check(g.d?.ok === true, "autopilot: POST /api/orders/:id/go", g.d);
  const run = await until(() => events.slice(from).find((e) => e.type === "workflow.updated" && e.run.teamId === 1 && e.run.steps[0]?.orderId === p.id)?.run, 5000);
  check(!!run && run.targetId === p.targetId && run.steps[0].nodeId === "planner", "autopilot: go starts a run whose planner step is the proposal order", run && { targetId: run.targetId, steps: run.steps });
  if (!run) return;
  const final = await runEnd(run.id, 60000);
  check(final?.status === "done", "autopilot: run done", final && steps(final));
  if (final?.status !== "done") explain(run.id, m);
  const st = await state();
  const orders = st.orders.filter((o: any) => o.runId === run.id);
  check(orders[0]?.id === p.id && orders.every((o: any) => o.source === "workflow" && o.status === "done"), "autopilot: the proposal order is the first done workflow step", orders.map((o: any) => `${o.id}:${o.source}:${o.status}`));
  check(!st.orders.some((o: any) => o.id !== p.id && o.targetId === p.targetId && o.status === "cancelled" && o.unitId === p.unitId), "autopilot: go cancelled nothing");
  check(st.targets.find((t: any) => t.id === p.targetId)?.status === "resolved", "autopilot: target resolved");
  await Bun.sleep(300); // veto rows are appended asynchronously
  const rows = (await Bun.file(VETO_LOG).text().catch(() => "")).trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } });
  const row = rows.filter((r) => r?.proposal?.teamId === 1 && r?.runId === run.id).pop();
  check(row?.action === "go" && row.proposal.unitId === p.unitId && row.proposal.targetId === p.targetId, `autopilot: veto log row with proposal.teamId and runId (${VETO_LOG})`, rows.slice(-2));
}

try {
  if (RESET) check((await call(`${E}/api/reset`, "POST", {})).d?.ok === true, "reset 4618");
  if (mockBefore) await call(`${MOCK}/debug/config`, "POST", { speed: SPEED, fail: 0, review: "loop" });
  void listen();
  check(!!(await until(() => events.find((e) => e.type === "state.snapshot"), 5000)), "SSE snapshot");
  const team = (await state()).teams.find((t: any) => t.id === 1);
  check(team?.members?.length >= 3, "team 1 has 3 members", team?.members);
  const m = (team?.members ?? []) as string[];
  const cases: Record<string, () => Promise<void>> = { trio: () => trio(m), needs_human: needsHuman, cancel, duel: () => duel(m), autopilot: () => autopilot(m) };
  for (const name of CASES) {
    if (reloaded) break;
    if (!cases[name]) { check(false, `unknown case ${name}`); continue; }
    await cases[name]!();
  }
  if (reloaded) check(false, "engine stayed up during the test", reloaded);
  check((await call(`${E}/api/teams/1/workflow`, "DELETE")).d?.team?.workflow === null, "DELETE workflow clears it");
} finally {
  ctl.abort();
  clearTimeout(watchdog);
  if (CASES.includes("autopilot")) await call(`${E}/api/teams/1`, "PATCH", { autopilot: false });
  await restoreMock();
}
console.log(failures ? `${failures} FAILED` : "workflow e2e passed");
process.exit(failures ? 1 : 0);
