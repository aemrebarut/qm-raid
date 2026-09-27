// Demo-path dry run on the bridge only (no engine): wave 1 unit recalls + remembers on billing, wave 2 unit recalls
// and should cite wave 1's learning slug. Test ids qmdry-*; cleanup deletes the units and forgets only the learning
// slugs the qmdry units passed to gbrain.remember. Run: bun test/demo-dry.ts
// Env: BRIDGE_URL (default http://127.0.0.1:4614), BRAIN_URL (default http://127.0.0.1:4616), DRY_MODEL, DRY_EFFORT.
const BRIDGE = process.env.BRIDGE_URL ?? "http://127.0.0.1:4614";
const BRAIN = process.env.BRAIN_URL ?? "http://127.0.0.1:4616";
const MODEL = process.env.DRY_MODEL ?? "gpt-6-sol";
const EFFORT = process.env.DRY_EFFORT ?? "medium";
const TARGET = { id: "t101", issue: "LUM-101", title: "Payment retry double-charges a card", kind: "bug", severity: 3, component: "billing", customers: ["acme-robotics"] };

const run = Date.now().toString(36);
const t0 = Date.now();
const at = (t = Date.now()) => `${((t - t0) / 1000).toFixed(1)}s`;
type Ev = { type: string; unitId?: string; orderId?: string; kind?: string; text?: string; tool?: string; args?: Record<string, unknown> };
const events: (Ev & { t: number })[] = [];

// Same text as the engine's orderPrompt (services/engine/src/game.ts).
function orderText(unitId: string, orderId: string, slug: string): string {
  const t = TARGET;
  const pages = [`components/${t.component}`, `issues/${t.issue.toLowerCase()}`, ...t.customers.map((c) => `companies/${c}`)];
  return [
    `Order ${orderId}: work on issue ${t.issue} "${t.title}" (${t.kind}, severity ${t.severity}).`,
    `Component: ${t.component}`,
    `Customers: ${t.customers.join(", ")}`,
    `GBrain pages: ${pages.join(", ")}`,
    `Lumen is a synthetic product with no code checkout; GBrain is your only source. 1) Recall first: call the gbrain recall tool with componentId ${t.component}, targetId ${t.id} and unitId ${unitId}, and search GBrain for house rules and past learnings on this component. 2) Decide the fix and say it in 3 to 5 sentences, naming any rule you applied. 3) Remember: call the gbrain remember tool with slug ${slug}, targetId ${t.id}, unitId ${unitId} and one or two sentences of what you learned. Reply in at most 4 sentences.`,
  ].join("\n");
}

async function listen(signal: AbortSignal): Promise<void> {
  const res = await fetch(`${BRIDGE}/events?observe=1`, { signal }); // observer: never takes the engine's backlog
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const ev = JSON.parse(data.slice(6)) as Ev;
      if (ev.unitId?.startsWith(`qmdry-${run}`)) events.push({ ...ev, t: Date.now() });
    }
  }
}

async function call(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ status: res.status }));
}

async function wave(n: number, cite?: string) {
  const unitId = `qmdry-${run}-w${n}`;
  const orderId = `od-${run}-${n}`;
  const slug = `learnings/lum-101-${unitId}-${Date.now()}`;
  const spawned = await call("POST", `${BRIDGE}/units`, { id: unitId, name: `Dry ${n}`, model: MODEL, effort: EFFORT, role: "ranger", team: null });
  const tSend = Date.now();
  await call("POST", `${BRIDGE}/units/${unitId}/send`, { text: orderText(unitId, orderId, slug), orderId, targetId: TARGET.id, componentId: TARGET.component });
  const deadline = Date.now() + 240_000;
  let terminal: (Ev & { t: number }) | undefined;
  while (!terminal && Date.now() < deadline) {
    await Bun.sleep(250);
    terminal = events.find((e) => e.orderId === orderId && (e.type === "reply" || e.type === "error"));
  }
  const mine = events.filter((e) => e.orderId === orderId);
  const first = mine.find((e) => e.type === "activity");
  const tools = mine.filter((e) => e.kind === "tool").map((e) => e.tool);
  const remembered = mine.filter((e) => e.tool === "gbrain.remember").map((e) => String(e.args?.slug ?? "")).filter(Boolean);
  const errors = mine.filter((e) => e.type === "error" || e.kind === "error").map((e) => e.text);
  const report = {
    wave: n,
    unitId,
    orderId,
    sessionUrl: spawned.sessionUrl,
    first: first ? `+${((first.t - tSend) / 1000).toFixed(1)}s` : null,
    terminal: terminal ? `+${((terminal.t - tSend) / 1000).toFixed(1)}s ${terminal.type}` : "none (timeout)",
    tools,
    recall: tools.includes("gbrain.recall"),
    remember: remembered,
    citesWave1: cite ? Boolean(terminal?.text?.includes(cite)) : undefined,
    errors,
    reply: terminal?.text,
  };
  console.log(JSON.stringify(report, null, 1));
  return { unitId, remembered, slug };
}

const ac = new AbortController();
void listen(ac.signal).catch(() => {});
await Bun.sleep(300);
console.log(`[${at()}] dry run ${run} model ${MODEL}/${EFFORT} on ${BRIDGE}`);
const w1 = await wave(1);
const w1Slug = w1.remembered[0] ?? w1.slug;
const page = await fetch(`${BRAIN}/page?slug=${encodeURIComponent(w1Slug)}`).then((r) => r.status);
console.log(`[${at()}] wave 1 learning ${w1Slug} in brain: ${page === 200 ? "yes" : `no (${page})`}`);
const w2 = await wave(2, w1Slug);

// Cleanup: delete test units; forget only learning slugs the qmdry units passed to gbrain.remember.
for (const u of [w1.unitId, w2.unitId]) await call("DELETE", `${BRIDGE}/units/${u}`);
const forgotten: string[] = [];
if (process.env.DRY_KEEP !== "1") {
  for (const slug of [...w1.remembered, ...w2.remembered]) {
    const r = await call("POST", `${BRAIN}/forget`, { slug });
    if (r?.ok) forgotten.push(slug);
  }
}
console.log(`[${at()}] cleanup: deleted ${w1.unitId}, ${w2.unitId}; forgot ${forgotten.join(", ") || "nothing"}`);
ac.abort();
process.exit(0);
