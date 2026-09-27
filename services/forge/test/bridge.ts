// Bridge API smoke for forge units: forge must be running with at least one ready type (dry run is fine).
// Spawns a unit, sends a direct message (no brain writes), and waits for its reply on GET /events.
const BASE = process.env.FORGE_URL ?? "http://127.0.0.1:4612";
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };

const types = (await fetch(`${BASE}/types`).then((r) => r.json())) as any[];
const ready = types.find((t) => t.status === "ready");
if (!ready) fail("no ready type; POST /types and wait about 60 s (dry run) first");

const events: any[] = [];
const ctrl = new AbortController();
const res = await fetch(`${BASE}/events`, { signal: ctrl.signal });
(async () => {
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of res.body as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
      }
    }
  } catch {}
})();

const id = `smoke-${Date.now()}`;
const spawn = await fetch(`${BASE}/units`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ id, name: "Smoke", model: ready.model, effort: "low", role: "worker", team: null }) }).then((r) => r.json());
if (!("sessionId" in spawn)) fail(`POST /units: ${JSON.stringify(spawn)}`);
const sent = await fetch(`${BASE}/units/${id}/send`, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ text: "Status check: who are you and what is your job?" }) }).then((r) => r.json());
if (!sent.ok) fail(`send: ${JSON.stringify(sent)}`);
const bad = await fetch(`${BASE}/units/${id}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
if (bad.status !== 400) fail(`empty send should be 400, got ${bad.status}`);

let reply: any = null;
for (let i = 0; i < 60 && !reply; i++) { await Bun.sleep(500); reply = events.find((e) => e.unitId === id && e.type === "reply"); }
const err = events.find((e) => e.unitId === id && (e.type === "error" || e.kind === "error"));
if (err) fail(`error event: ${err.text}`);
if (!reply) fail(`no reply within 30 s; events: ${JSON.stringify(events.filter((e) => e.unitId === id))}`);
console.log(`reply from ${ready.id}:`, reply.text.slice(0, 120).replace(/\n/g, " "));
await fetch(`${BASE}/units/${id}`, { method: "DELETE" });
ctrl.abort();
console.log("PASS");
process.exit(0);
