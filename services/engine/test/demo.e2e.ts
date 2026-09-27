// Demo path e2e on the TEST engine (4618, mock backend), owner raid-eng-mock. Never point it at 4610 (real QM).
//   bun test/demo.e2e.ts [--runs 2] [--no-reset]
// Per run: POST /api/reset (4618 has BRAIN_RESET=0, so only engine state), mock script demo with an empty demo memory,
// wave 1 billing order learns the rule, wave 2 billing order recalls wave 1's exact learning slug (memory.recall slugs,
// reply, and brain GET /page?slug= via the engine's mock mirror), then one autopilot proposal vetoed and one sent with go.
// Env: ENGINE_URL (http://127.0.0.1:4618), MOCK_URL (http://127.0.0.1:4615), BRAIN_URL (http://127.0.0.1:4616),
// VETO_LOG (/tmp/engplan/vetoes-test.jsonl). The shared mock config is restored at the end.
const E = (process.env.ENGINE_URL ?? "http://127.0.0.1:4618").replace(/\/$/, "");
const MOCK = (process.env.MOCK_URL ?? "http://127.0.0.1:4615").replace(/\/$/, "");
const BRAIN = (process.env.BRAIN_URL ?? "http://127.0.0.1:4616").replace(/\/$/, "");
const VETO_LOG = process.env.VETO_LOG ?? "/tmp/engplan/vetoes-test.jsonl";
const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? dflt : dflt; };
const RUNS = Math.max(1, Number(arg("--runs", "2")) || 2);
const RESET = !process.argv.includes("--no-reset");
if (new URL(E).port === "4610") { console.error("refusing to run against 4610 (the real QM engine); use the test engine on 4618"); process.exit(2); }

const H = { "content-type": "application/json" };
type Res = { s: number; d: any };
async function call(url: string, method = "GET", body?: unknown): Promise<Res> {
  try {
    const r = await fetch(url, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    return { s: r.status, d: await r.json().catch(() => null) };
  } catch { return { s: 0, d: null }; }
}

// ---- engine SSE ----
const events: any[] = [];
const sseCtl = new AbortController();
// Reconnects: the test engine runs under bun --watch and restarts whenever engine files change.
async function listen(): Promise<void> {
  let first = true;
  while (!sseCtl.signal.aborted) {
    try {
      const r = await fetch(`${E}/api/events`, { signal: sseCtl.signal });
      const rd = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          for (const line of blk.split("\n")) if (line.startsWith("data:")) {
            try {
              const e = JSON.parse(line.slice(5).trim());
              if (e.type === "state.snapshot" && !first) console.log("     (engine SSE reconnected: engine restarted or reset)");
              if (e.type === "state.snapshot") first = false;
              events.push(e);
            } catch {}
          }
        }
      }
    } catch {}
    if (!sseCtl.signal.aborted) await Bun.sleep(500);
  }
}
async function waitFor<T>(pred: () => T | undefined | null | false, ms: number): Promise<T | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await Bun.sleep(150); }
  return null;
}
const since = (i: number) => events.slice(i);

let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures++; return ok; };

async function orderDone(orderId: string, from: number, ms = 50000) {
  return waitFor(() => since(from).find((e) => e.type === "order.updated" && e.order?.id === orderId && ["done", "failed", "cancelled"].includes(e.order.status))?.order, ms);
}

async function vetoRows(): Promise<any[]> {
  const txt = await Bun.file(VETO_LOG).text().catch(() => "");
  return txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function run(n: number): Promise<void> {
  console.log(`\n=== run ${n} ===`);
  if (RESET) {
    const r = await call(`${E}/api/reset`, "POST", {});
    check(r.d?.ok === true, `POST /api/reset on ${E}`);
    await Bun.sleep(1500); // units re-register with the bridge
  }
  check((await call(`${MOCK}/debug/config`, "POST", { script: "demo", fail: 0, noGbrain: false, mcpNames: 0 })).d?.config?.script === "demo", "mock script demo");
  check((await call(`${MOCK}/debug/reset`, "POST", {})).d?.ok === true, "mock demo memory cleared");

  const st = (await call(`${E}/api/state`)).d;
  if (!check(!!st && Array.isArray(st.units), "GET /api/state")) return;
  for (const t of st.teams ?? []) if (t.autopilot) await call(`${E}/api/teams/${t.id}`, "PATCH", { autopilot: false });
  const billing = st.targets.filter((t: any) => t.component === "billing" && t.status === "open").sort((a: any, b: any) => b.severity - a.severity);
  const idle = st.units.filter((u: any) => u.status === "idle" && !u.orderId);
  if (!check(billing.length >= 2 && idle.length >= 2, `2 open billing targets (${billing.length}) and 2 idle units (${idle.length})`)) return;
  const [t1, t2] = billing, [u1, u2] = idle;

  // wave 1
  let from = events.length;
  const o1 = await call(`${E}/api/orders`, "POST", { unitIds: [u1.id], targetId: t1.id });
  const oid1 = o1.d?.orders?.[0]?.id ?? o1.d?.order?.id;
  if (!check(o1.d?.ok === true && !!oid1, `wave 1: ${u1.name} -> ${t1.issue} (${oid1})`)) return;
  const d1 = await orderDone(oid1, from);
  check(d1?.status === "done", `wave 1 order done (${d1?.status ?? "timeout"})`);
  const w1 = since(from);
  const rem1 = w1.find((e) => e.type === "memory.remember" && e.unitId === u1.id && String(e.slug).startsWith("learnings/"));
  const learn = rem1?.slug as string | undefined;
  check(!!learn && learn.startsWith(`learnings/${t1.issue.toLowerCase()}-${u1.id}-`), `wave 1 memory.remember ${learn}`);
  check(!w1.some((e) => e.type === "memory.recall" && e.unitId === u1.id && (e.slugs ?? []).some((s: string) => s.startsWith("learnings/"))), "wave 1 recalled no learning (clean memory)");
  check(w1.some((e) => e.type === "memory.link" && e.from === learn && e.to === "rules/billing-idempotency"), "wave 1 memory.link learning -> rules/billing-idempotency");
  let page: any = null;
  for (const t0 = Date.now(); learn && !page && Date.now() - t0 < 8000; await Bun.sleep(500)) {
    const r = await call(`${BRAIN}/page?slug=${encodeURIComponent(learn)}`);
    if (r.s === 200 && r.d?.slug === learn) page = r.d;
  }
  check(!!page, `brain GET /page?slug=${learn} returns the learning (engine mirror)`);

  // wave 2
  from = events.length;
  const o2 = await call(`${E}/api/orders`, "POST", { unitIds: [u2.id], targetId: t2.id });
  const oid2 = o2.d?.orders?.[0]?.id ?? o2.d?.order?.id;
  if (!check(o2.d?.ok === true && !!oid2, `wave 2: ${u2.name} -> ${t2.issue} (${oid2})`)) return;
  const d2 = await orderDone(oid2, from);
  check(d2?.status === "done", `wave 2 order done (${d2?.status ?? "timeout"})`);
  const w2 = since(from);
  check(!!learn && w2.some((e) => e.type === "memory.recall" && e.unitId === u2.id && (e.slugs ?? []).includes(learn)), `wave 2 memory.recall slugs include ${learn}`);
  check(!!learn && typeof d2?.reply === "string" && d2.reply.includes(learn), "wave 2 reply quotes the learning slug");

  // autopilot: one proposal vetoed (cancel), one sent (go)
  const rowsBefore = (await vetoRows()).length;
  from = events.length;
  const team = (await call(`${E}/api/state`)).d?.teams?.find((t: any) => t.members.length > 0);
  if (!check(!!team, "a team with members")) return;
  check((await call(`${E}/api/teams/${team.id}`, "PATCH", { autopilot: true })).d?.ok === true, `autopilot on team ${team.id}`);
  const props: any[] = [];
  const take = async () => {
    const e = await waitFor(() => since(from).find((e) => e.type === "order.proposed" && !props.some((p) => p.id === e.order.id)), 20000);
    if (e) props.push(e.order);
    return e?.order;
  };
  const p1 = await take();
  if (check(!!p1 && typeof p1.vetoDeadline === "number", `proposal 1 ${p1?.unitId} -> ${p1?.targetId}`)) {
    check((await call(`${E}/api/orders/${p1.id}/cancel`, "POST", {})).d?.ok === true, `veto (cancel) ${p1.id}`);
  }
  const p2 = await take();
  if (check(!!p2, `proposal 2 ${p2?.unitId} -> ${p2?.targetId}`)) {
    check((await call(`${E}/api/orders/${p2.id}/go`, "POST", {})).d?.ok === true, `go ${p2.id}`);
  }
  await call(`${E}/api/teams/${team.id}`, "PATCH", { autopilot: false });
  // resolve any other proposals of this tick so nothing is left waiting
  for (const e of since(from)) if (e.type === "order.proposed" && !props.some((p) => p.id === e.order.id)) { await call(`${E}/api/orders/${e.order.id}/cancel`, "POST", {}); }
  await Bun.sleep(800);
  const rows = (await vetoRows()).slice(rowsBefore);
  const has = (p: any, action: string) => !!p && rows.some((r) => r.action === action && r.proposal?.unitId === p.unitId && r.proposal?.targetId === p.targetId);
  check(has(p1, "cancel"), "veto log has the cancel row");
  check(has(p2, "go"), "veto log has the go row");
  const reasons = since(from).filter((e) => e.type === "order.proposed").map((e) => e.order.id);
  console.log(`     proposals this run: ${reasons.join(", ")}`);
  if (p2) {
    const d = await orderDone(p2.id, from, 50000);
    check(d?.status === "done", `go order ${p2.id} done (${d?.status ?? "timeout"})`);
  }
}

void listen();
await Bun.sleep(500);
const saved = (await call(`${MOCK}/debug/config`)).d?.config;
if (!check(!!saved, `mock config readable at ${MOCK}`)) process.exit(1);
try {
  for (let n = 1; n <= RUNS; n++) {
    const before = failures;
    await run(n);
    console.log(failures === before ? `run ${n}: PASS` : `run ${n}: ${failures - before} FAIL`);
  }
} finally {
  await call(`${MOCK}/debug/config`, "POST", saved);
  sseCtl.abort();
}
console.log(failures ? `\ndemo e2e: ${failures} check(s) failed` : `\ndemo e2e: ALL PASS (${RUNS} run${RUNS > 1 ? "s" : ""} in a row)`);
process.exit(failures ? 1 : 0);
