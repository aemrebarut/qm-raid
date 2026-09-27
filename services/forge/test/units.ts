// Offline units test (reviewer P1): a direct message sent while an order is running must not abandon the order.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnits } from "../src/units";

process.env.BRAIN_URL = "http://127.0.0.1:9"; // brain unreachable: the loop degrades and still replies
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };
const waiters: Array<(t: string) => void> = [];
const units = createUnits({
  types: () => [{ id: "forge-t", name: "Tester", description: "d", status: "ready", model: "dry-run:forge-t", baseModel: null }],
  ask: () => new Promise<string>((res) => waiters.push(res)),
  store: join(mkdtempSync(join(tmpdir(), "forge-units-")), "units.json"),
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
console.log("PASS");
process.exit(0);
