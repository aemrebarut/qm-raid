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
// Write test cleans up after itself (POST /forget), so it never leaves learnings in the demo brain.
if (process.env.SMOKE_WRITE === "1") {
  await check("remember writes a learning that recall returns", async () => {
    const { slug } = await post("/remember", { unitId: "smoke", targetId: "t101", text: "Smoke learning: reuse inv_<invoiceId> as the key on retries." });
    const r = await post("/recall", { componentId: "billing", targetId: "t101", unitId: "u2" });
    // Regression (raid-rev via river): the learning survives callers that keep only the first 1500 chars.
    const early = r.context.slice(0, 1500).includes("Smoke learning: reuse inv_<invoiceId>");
    if (!early) console.log("  learning text not in the first 1500 chars of recall context");
    // Regression (raid-rev): a new learning's edges are in /graph at once (no wait for gbrain's link sweep).
    const g = await get("/graph");
    const edgesNow = ["issues/lum-101", "components/billing", "units/smoke"].every((to) => g.edges.some((e: any) => e.from === slug && e.to === to));
    if (!edgesNow) console.log("  learning edges missing from /graph");
    // Regression (raid-rev): parallel add_link on one page must keep both links.
    const mcp = (id: number, args: object) => fetch(BASE.replace(/:4616$/, ":4617") + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "add_link", arguments: args } }) }).then((r) => r.json());
    await Promise.all([mcp(1, { from: slug, to: "companies/orchard-education" }), mcp(2, { from: slug, to: "companies/brightpath-clinics" })]);
    const page = await get("/page?slug=" + encodeURIComponent(slug));
    const bothLinks = page.body.includes("[[companies/orchard-education]]") && page.body.includes("[[companies/brightpath-clinics]]");
    if (!bothLinks) console.log("  parallel add_link lost a link");
    // Engine-assigned slug is used as given (MCP remember).
    const want = `learnings/lum-101-smoke-${Date.now()}`;
    const res = await fetch(BASE.replace(/:4616$/, ":4617") + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "remember", arguments: { slug: want, targetId: "t101", unitId: "smoke", text: "Smoke learning with a given slug." } } }) }).then((r) => r.json());
    const givenOk = JSON.parse(res.result.content[0].text).slug === want && (await get("/page?slug=" + encodeURIComponent(want))).slug === want;
    if (!givenOk) console.log("  remember ignored the given slug");
    await post("/forget", { slug: want });
    await post("/forget", { slug });
    const after = await post("/recall", { componentId: "billing", targetId: "t101", unitId: "u2" });
    await post("/forget", { slug: "units/smoke" });
    return slug.startsWith("learnings/lum-101-smoke-") && r.slugs.includes(slug) && early && edgesNow && bothLinks && givenOk && !after.slugs.includes(slug) && !after.slugs.includes(want);
  });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
