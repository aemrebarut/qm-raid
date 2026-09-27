// Offline units test (reviewer P1): a direct message sent while an order is running must not abandon the order.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnits, finalVerdict, lastVerdict, roleOf, sections } from "../src/units";

// No network at all: the shared game brain must never see this test (recall and remember degrade, the loop still replies).
const calls: string[] = [];
globalThis.fetch = (async (u: any) => { calls.push(String(u)); throw new Error("network disabled in test"); }) as any;
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };
// Reviewer verdicts (P2): only APPROVED or CHANGES with a detail count, and only on the final line.
for (const [t, f, l] of [
  ["Plan: x\nVERDICT: APPROVED", "VERDICT: APPROVED", "VERDICT: APPROVED"],
  ["VERDICT: NEEDS WORK", null, null],
  ["VERDICT: CHANGES: fix duplicate capture\nRemember: y", null, "VERDICT: CHANGES: fix duplicate capture"],
  ["**VERDICT: CHANGES: add a test**", "VERDICT: CHANGES: add a test", "VERDICT: CHANGES: add a test"],
  ["VERDICT: CHANGES:", null, null],
  ["Pick: B\nVERDICT: APPROVED (winner: Rhea)", "VERDICT: APPROVED (winner: Rhea)", "VERDICT: APPROVED (winner: Rhea)"],
] as const) if (finalVerdict(t) !== f || lastVerdict(t) !== l) fail(`verdict ${JSON.stringify(t)}: ${finalVerdict(t)} / ${lastVerdict(t)}`);

// Roles: only this node's own Role line counts, never a verdict quoted in previous work.
const herald = "Order o3: work on issue LUM-7\n\nRole: herald. Write the customer update for the affected customers.\nPrevious work:\n- reviewer (u2): ok\nVERDICT: APPROVED";
if (roleOf(herald)?.role !== "herald" || /VERDICT/.test(roleOf(herald)!.instructions)) fail(`herald role: ${JSON.stringify(roleOf(herald))}`);
if (!/VERDICT/.test(roleOf("Order\n\nRole: reviewer. Review it. End with VERDICT: APPROVED or VERDICT: CHANGES: <what>.")?.instructions ?? "")) fail("reviewer role");
if (roleOf("Order o1: plain order") !== null) fail("plain order has no role");
const custom = roleOf("Order\n\nRole: checker. Review against rules.\nEnd with VERDICT: APPROVED or VERDICT: CHANGES: <what>.\nPrevious work:\n- implementer (u1): done");
if (!custom || !/VERDICT/.test(custom.instructions) || /implementer/.test(custom.instructions)) fail(`multi-line role: ${JSON.stringify(custom)}`);
if (sections("Plan: p\nCustomer update: Hello team\nRemember: r")["customer reply"] !== "Hello team") fail("customer update heading");

const waiters: Array<(t: string) => void> = [];
const units = createUnits({
  types: () => [{ id: "forge-t", name: "Tester", description: "d", status: "ready", model: "dry-run:forge-t", baseModel: null }],
  ask: () => new Promise<string>((res) => waiters.push(res)),
  store: join(mkdtempSync(join(tmpdir(), "forge-units-")), "units.json"),
  brainUrl: "http://127.0.0.1:9",
});
const events: any[] = [];
const res = (await units.handle(new Request("http://x/events"), new URL("http://x/events")))!;
(async () => { const dec = new TextDecoder(); for await (const c of res.body as any) for (const b of dec.decode(c).split("\n\n")) if (b.startsWith("data: ")) events.push(JSON.parse(b.slice(6))); })();
const post = (path: string, body: unknown) => units.handle(new Request(`http://x${path}`, { method: "POST", body: JSON.stringify(body) }), new URL(`http://x${path}`));
await post("/units", { id: "u1", name: "U1", model: "dry-run:forge-t" });
await post("/units/u1/send", { text: "order A", orderId: "A", targetId: "t1", componentId: "billing" });
const until = async (ok: () => boolean, what: string) => { for (let i = 0; i < 400 && !ok(); i++) await Bun.sleep(50); if (!ok()) fail(`timed out waiting for ${what}`); };
await until(() => waiters.length === 1, "the order to reach the model"); // recall fails against the unreachable brain first
await post("/units/u1/send", { text: "status?" });
await until(() => waiters.length === 2, "the direct message to reach the model");
for (const w of waiters.splice(0)) w("Plan: fix it\nDecision: ship\nRemember: lesson");
const replies = () => events.filter((e) => e.type === "reply" && e.unitId === "u1");
await until(() => replies().length >= 2, `both replies, got ${JSON.stringify(replies())}`);
if (!replies().some((e) => e.orderId === "A")) fail(`order A got no terminal reply: ${JSON.stringify(replies())}`);
if (!replies().some((e) => !e.orderId)) fail("direct message got no reply");
const list = await (await units.handle(new Request("http://x/units"), new URL("http://x/units")))!.json();
if (list[0].orderId !== null) fail(`orderId not cleared: ${list[0].orderId}`);
if (calls.some((c) => !c.startsWith("http://127.0.0.1:9/"))) fail(`unexpected network calls: ${calls.join(", ")}`);
// A unit whose type was deleted rebinds to the newest River-trained type, never to a newer dry-run smoke type.
const store2 = join(mkdtempSync(join(tmpdir(), "forge-units-")), "units.json");
await Bun.write(store2, JSON.stringify([{ id: "u7", name: "Rhea", typeId: "forge-gone", team: null }]));
const asked: string[] = [];
const units2 = createUnits({
  types: () => [{ id: "forge-real", name: "Real", description: "d", status: "ready", model: "river://ckpt", baseModel: "b" },
                { id: "forge-smoke", name: "Smoke", description: "d", status: "ready", model: "dry-run:forge-smoke", baseModel: null }],
  ask: async (r) => { asked.push(r.model); return "Plan: p\nDecision: d"; },
  store: store2, brainUrl: "http://127.0.0.1:9",
});
await units2.handle(new Request("http://x/units/u7/send", { method: "POST", body: JSON.stringify({ text: "hi" }) }), new URL("http://x/units/u7/send"));
await Bun.sleep(100);
const bound = (await (await units2.handle(new Request("http://x/units"), new URL("http://x/units")))!.json())[0];
if (bound.typeId !== "forge-real" || asked[0] !== "river://ckpt") fail(`rebind: ${JSON.stringify(bound)} asked ${asked}`);

// Its River type deleted and only a smoke type ready: no silent dry substitute, the order errors visibly.
const store4 = join(mkdtempSync(join(tmpdir(), "forge-units-")), "units.json");
await Bun.write(store4, JSON.stringify([{ id: "u8", name: "Ada", typeId: "forge-gone", team: null }]));
const asked4: string[] = [], ev4: any[] = [];
const units4 = createUnits({
  types: () => [{ id: "forge-smoke", name: "Smoke", description: "d", status: "ready", model: "dry-run:forge-smoke", baseModel: null }],
  ask: async (r) => { asked4.push(r.model); return "Decision: d"; }, store: store4, brainUrl: "http://127.0.0.1:9",
});
const res4 = (await units4.handle(new Request("http://x/events"), new URL("http://x/events")))!;
(async () => { const dec = new TextDecoder(); for await (const c of res4.body as any) for (const b of dec.decode(c).split("\n\n")) if (b.startsWith("data: ")) ev4.push(JSON.parse(b.slice(6))); })();
await units4.handle(new Request("http://x/units/u8/send", { method: "POST", body: JSON.stringify({ text: "o", orderId: "Z" }) }), new URL("http://x/units/u8/send"));
await Bun.sleep(100);
const u8 = (await (await units4.handle(new Request("http://x/units"), new URL("http://x/units")))!.json())[0];
if (asked4.length || u8.typeId !== "forge-gone" || !ev4.some((e) => e.type === "error" && e.orderId === "Z")) fail(`dry substitute: asked ${asked4} bound ${u8.typeId}`);

// Loadout: standing orders reach the model; with GBrain off an order makes no brain calls.
const cat = await (await units2.handle(new Request("http://x/catalog"), new URL("http://x/catalog")))!.json();
if (cat.items?.[0]?.id !== "gbrain") fail(`catalog: ${JSON.stringify(cat)}`);
const reqs: any[] = [];
const units3 = createUnits({
  types: () => [{ id: "forge-real", name: "Real", description: "d", status: "ready", model: "river://ckpt", baseModel: "b" }],
  ask: async (r) => { reqs.push(r); return "Decision: d\nRemember: r"; },
  store: join(mkdtempSync(join(tmpdir(), "forge-units-")), "units.json"), brainUrl: "http://127.0.0.1:9",
});
const u3 = (path: string, method: string, body: unknown) => units3.handle(new Request(`http://x${path}`, { method, body: JSON.stringify(body) }), new URL(`http://x${path}`));
await u3("/units", "POST", { id: "u9", name: "Nine" });
const patched = await (await u3("/units/u9", "PATCH", { loadout: { instructions: "Always cite the rule slug.", skills: [], plugins: [] } }))!.json();
if (!patched.ok || patched.loadout.plugins.length !== 0) fail(`patch: ${JSON.stringify(patched)}`);
const before = calls.length;
await u3("/units/u9/send", "POST", { text: "order", orderId: "L1", targetId: "t1", componentId: "billing" });
await Bun.sleep(100);
if (reqs[0]?.instructions !== "Always cite the rule slug.") fail(`instructions not passed: ${JSON.stringify(reqs[0])}`);
if (calls.length !== before) fail(`brain called with GBrain off: ${calls.slice(before)}`);
console.log("PASS");
process.exit(0);
