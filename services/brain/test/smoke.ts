// Smoke test: run with the service up (bun run dev), then `bun run test`.
const BASE = process.env.BRAIN_URL ?? "http://127.0.0.1:4616";
let failed = 0;
async function check(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`FAIL ${name}: ${(e as Error).message}`);
    failed++;
  }
}
const get = (p: string) => fetch(BASE + p).then((r) => r.json());
const post = (p: string, b: object) => fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

await check("health", async () => (await get("/health")).ok === true);
await check("world has 4 components, 9 targets, 5 customers", async () => {
  const w = await get("/world");
  return w.components.length === 4 && w.targets.length === 9 && w.customers.length === 5 && w.buildings.length === 3;
});
await check("stats pages > 20", async () => (await get("/stats")).pages > 20);
await check("page components/billing", async () => (await get("/page?slug=" + encodeURIComponent("components/billing"))).title === "Billing");
await check("search idempotency finds the billing rule", async () => (await get("/search?q=idempotency")).some((r: any) => r.slug === "rules/billing-idempotency"));
await check("recall t101 returns component, rule, issue, customer", async () => {
  const r = await post("/recall", { componentId: "billing", targetId: "t101", unitId: "u1" });
  return ["components/billing", "rules/billing-idempotency", "issues/lum-101", "companies/acme-robotics"].every((s) => r.slugs.includes(s)) && r.context.length > 100;
});
await check("graph has nodes and edges", async () => {
  const g = await get("/graph");
  return g.nodes.length > 20 && g.edges.length > 20;
});
if (process.env.SMOKE_WRITE === "1") {
  await check("remember writes a learning that recall returns", async () => {
    const { slug } = await post("/remember", { unitId: "smoke", targetId: "t101", text: "Smoke learning: reuse inv_<invoiceId> as the key on retries." });
    const r = await post("/recall", { componentId: "billing", targetId: "t101", unitId: "u2" });
    return slug.startsWith("learnings/lum-101-smoke-") && r.slugs.includes(slug);
  });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
