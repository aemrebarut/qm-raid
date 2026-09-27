// W1 live check on the TEST engine (4618, mock backend), owner raid-eng-flow. Never point it at 4610 (real QM).
//   /tmp/engplan/with4618 raid-eng-flow bun test/workflow.e2e.ts [--speed 4] [--no-reset]
// POST /api/reset (4618 has BRAIN_RESET=0), trio preset on team 1, team order on an open target, then expects
// planner -> implementer -> reviewer (changes) -> implementer -> reviewer (approved) -> run done, 5 workflow orders,
// 4 handoffs between the right units, and the target resolved only when the run is done. Mock config is restored.
// Env: ENGINE_URL (http://127.0.0.1:4618), MOCK_URL (http://127.0.0.1:4615).
const E = (process.env.ENGINE_URL ?? "http://127.0.0.1:4618").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:4615").replace(/\/$/, "");
const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? dflt : dflt; };
const SPEED = Number(arg("--speed", "4")) || 4;
const RESET = !process.argv.includes("--no-reset");
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

// ---- engine SSE ----
const events: any[] = [];
const ctl = new AbortController();
async function listen(): Promise<void> {
  const r = await fetch(`${E}/api/events`, { signal: ctl.signal });
  const rd = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await rd.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const blk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = blk.split("\n").find((l) => l.startsWith("data: "));
      if (line) try { events.push(JSON.parse(line.slice(6))); } catch {}
    }
  }
}
async function until<T>(pick: () => T | undefined, ms: number): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = pick();
    if (v !== undefined) return v;
    await Bun.sleep(200);
  }
  return undefined;
}

const mockBefore = (await call(`${MOCK}/debug/config`)).d?.config;
try {
  if (RESET) check((await call(`${E}/api/reset`, "POST", {})).d?.ok === true, "reset 4618");
  if (mockBefore) await call(`${MOCK}/debug/config`, "POST", { speed: SPEED, fail: 0, review: "loop" });
  void listen().catch(() => {});
  await until(() => events.find((e) => e.type === "state.snapshot"), 5000);
  const state = (await call(`${E}/api/state`)).d;
  const team = state.teams.find((t: any) => t.id === 1);
  check(team?.members?.length >= 3, "team 1 has 3 members", team?.members);
  const [planner, implementer, reviewer] = team.members as string[];

  const put = await call(`${E}/api/teams/1/workflow`, "PUT", { preset: "trio" });
  check(put.d?.ok === true && put.d.team?.workflow?.preset === "trio", "PUT trio preset", put.d);
  const target = state.targets.find((t: any) => t.status === "open");
  const order = await call(`${E}/api/orders`, "POST", { teamId: 1, targetId: target.id });
  const runId = order.d?.run?.id;
  check(order.d?.ok === true && typeof runId === "string", "team order starts a run", order.d);
  console.log(`run ${runId} on ${target.id} (${target.issue}); planner ${planner}, implementer ${implementer}, reviewer ${reviewer}`);

  let seen = "";
  const final = await until(() => {
    const u = events.filter((e) => e.type === "workflow.updated" && e.run.id === runId).pop();
    const now = u ? `${u.run.status} ${u.run.steps.map((s: any) => `${s.nodeId}:${s.status}`).join(" ")}` : "";
    if (now && now !== seen) { seen = now; console.log(`  ${now}`); }
    return u && u.run.status !== "running" ? u.run : undefined;
  }, 240000);
  check(!!final, "run finished within 240 s", seen);
  if (final) {
    check(final.status === "done", "run done", final.status);
    check(final.loops === 1, "one changes loop", final.loops);
    const steps = final.steps.map((s: any) => `${s.nodeId}:${s.status}:${s.unitId}`);
    check(JSON.stringify(steps) === JSON.stringify([`planner:done:${planner}`, `implementer:done:${implementer}`, `reviewer:changes:${reviewer}`, `implementer:done:${implementer}`, `reviewer:approved:${reviewer}`]), "steps planner, implementer, reviewer (changes), implementer, reviewer (approved)", steps);
    const hand = events.filter((e) => e.type === "workflow.handoff" && e.runId === runId).map((e) => `${e.fromUnitId}>${e.toUnitId}:${e.nodeId}`);
    check(JSON.stringify(hand) === JSON.stringify([`${planner}>${implementer}:implementer`, `${implementer}>${reviewer}:reviewer`, `${reviewer}>${implementer}:implementer`, `${implementer}>${reviewer}:reviewer`]), "4 handoffs between the right units", hand);
    const st = (await call(`${E}/api/state`)).d;
    const orders = st.orders.filter((o: any) => o.runId === runId);
    check(orders.length === 5 && orders.every((o: any) => o.source === "workflow" && o.status === "done"), "5 done orders with source workflow and runId", orders.map((o: any) => `${o.id}:${o.source}:${o.status}`));
    check(st.targets.find((t: any) => t.id === target.id)?.status === "resolved", "target resolved");
    const resolvedAt = events.findIndex((e) => e.type === "target.updated" && e.target.id === target.id && e.target.status === "resolved");
    const doneAt = events.findIndex((e) => e.type === "workflow.updated" && e.run.id === runId && e.run.status === "done");
    const lastStepDoneAt = events.findLastIndex((e) => e.type === "order.updated" && e.order.runId === runId && e.order.status === "done");
    check(resolvedAt > lastStepDoneAt && resolvedAt >= 0, "target resolved only after the last step (not on an earlier step)", { resolvedAt, lastStepDoneAt, doneAt });
    check(st.workflowRuns.some((r: any) => r.id === runId && r.status === "done"), "state.workflowRuns holds the run");
  }
  check((await call(`${E}/api/teams/1/workflow`, "DELETE")).d?.team?.workflow === null, "DELETE workflow clears it");
} finally {
  ctl.abort();
  if (mockBefore) await call(`${MOCK}/debug/config`, "POST", { speed: mockBefore.speed, fail: mockBefore.fail, review: mockBefore.review });
}
console.log(failures ? `${failures} FAILED` : "workflow e2e passed");
process.exit(failures ? 1 : 0);
