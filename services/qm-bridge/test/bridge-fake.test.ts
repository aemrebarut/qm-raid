// Bridge process against a fake QM portal (no QM needed): PATCH/POST validation happens before any change (shape, skill
// allowlist); plan A loadout changes send no QM turn and every order carries the no-edit line; the personal SOUL is
// restored to its startup baseline after a turn changed it; plan B SOUL writes are gated by LOADOUT_SOUL (restored
// units included) and a drifted scope SOUL is re-written before the unit's next turn. State goes to a temp dir (QM_BRIDGE_STATE_DIR),
// ports are ephemeral. Run: bun test test/bridge-fake.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NO_EDIT } from "../src/loadout.ts";

type Turn = { text: string; threadRef: string; model?: string; thinkingLevel?: string; scopeId?: string; soulAtStart?: string };
const turns: Turn[] = [];
const soulPuts: string[] = [];
const souls = new Map<string, string>();
let projectsCreated = 0;

const portal = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (pathname === "/api/runtime-config") return j({ scopeId: "personal:emre", approvedHarnesses: ["codex"], modelsByHarness: { codex: ["gpt-6-sol", "gpt-5.6-luna"] } });
    if (pathname === "/admin/api/spend") return j({ org: { tokens: 0, costUsd: 0 } });
    if (pathname === "/api/skills") return j({ skills: [] });
    if (pathname === "/api/sessions") {
      const refs = [...new Set(turns.map((t) => t.threadRef)), ...["qmtest-a", "u-old", "u-a"].map((id) => `web:emre:raid-r1-${id}`)];
      return j({ sessions: refs.map((threadRef, i) => ({ id: `s${i}`, threadRef })) });
    }
    if (pathname === "/api/turn" && req.method === "POST") {
      const t = (await req.json()) as Turn;
      turns.push({ ...t, ...(t.scopeId ? { soulAtStart: souls.get(t.scopeId) } : {}) });
      // Agents editing guidance during a turn (what QM's guidance tool does to the conversation scope's SOUL).
      if (t.scopeId && t.text.includes("already applied")) souls.set(t.scopeId, "DRIFTED");
      if (t.text.includes("DRIFT-ME")) souls.set("personal:emre", "HACKED");
      return j({ runId: `r${turns.length}`, status: "queued" });
    }
    if (/^\/api\/runs\/[^/]+\/events$/.test(pathname)) {
      return new Response('data: {"type":"RUN_FINISHED"}\n\n', { headers: { "content-type": "text/event-stream" } });
    }
    if (pathname.startsWith("/api/runs/")) return j({ status: "done", result: { status: "ok", reply: "ok" }, activity: [] });
    if (pathname === "/api/projects" && req.method === "POST") {
      projectsCreated++;
      return j({ id: `p${projectsCreated}`, scopeId: `group:web-project-p${projectsCreated}` });
    }
    const scope = pathname.match(/^\/admin\/api\/scopes\/([^/]+)(\/soul)?$/);
    if (scope) {
      const id = decodeURIComponent(scope[1]!);
      if (req.method === "PUT") {
        soulPuts.push(id);
        souls.set(id, String(((await req.json()) as { content: string }).content));
        return j({ ok: true });
      }
      return j({ id, soul: souls.get(id) ?? null });
    }
    return j({ error: "not found" }, 404);
  },
});

const dir = mkdtempSync(join(tmpdir(), "qmb-fake-"));
let bridge: ReturnType<typeof Bun.spawn> | null = null;
let base = "";

let out = ""; // bridge stdout + stderr
const events: any[] = []; // observer stream
const unit = (id: string, scopeId: string | undefined, queue: unknown[] = []) => ({
  id,
  name: id,
  model: "gpt-5.6-luna",
  effort: "low",
  role: "worker",
  team: 1,
  ...(scopeId ? { scopeId } : {}),
  threadRef: `web:emre:raid-r1-${id}`,
  sessionId: `s-${id}`,
  queue,
  active: null,
});

beforeAll(async () => {
  // Restored state: qmtest-a matches LOADOUT_SOUL=qmtest-; u-old has a scope from an earlier flag value and a pending
  // agent SOUL write, and must now get plan A only.
  writeFileSync(
    join(dir, "units.json"),
    JSON.stringify({
      units: [unit("qmtest-a", "group:web-project-pa"), unit("u-old", "group:web-project-pb", [{ text: "OLD SOUL WRITE", intro: true, soul: true, key: "k-old" }]), unit("u-a", undefined)],
      retired: [],
      undelivered: [],
      projects: { "qmtest-a": { projectId: "pa", scopeId: "group:web-project-pa" }, "u-old": { projectId: "pb", scopeId: "group:web-project-pb" } },
    }),
  );
  bridge = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "server.ts")], {
    env: { ...process.env, PORT: "0", QM_PORTAL_URL: `http://127.0.0.1:${portal.port}`, QM_BRIDGE_STATE_DIR: dir, QM_THREAD_NS: "r1", QM_PRINCIPAL: "emre", LOADOUT_SOUL: "qmtest-" },
    stdout: "pipe",
    stderr: "pipe", // warnings (BRIDGE WARN ...) go to stderr
  });
  let exited = false;
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const dec = new TextDecoder();
    for await (const chunk of stream) out += dec.decode(chunk);
    exited = true;
  };
  void drain(bridge.stdout as ReadableStream<Uint8Array>);
  void drain(bridge.stderr as ReadableStream<Uint8Array>);
  // Up once it listens and the model catalog loaded (restored queues are pumped then).
  await until(() => exited || out.includes("codex models"), 25_000);
  base = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? "";
  if (!base || !out.includes("codex models")) throw new Error(`bridge not up: ${out}`);
  void (async () => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of (await fetch(`${base}/events?observe=1`)).body as ReadableStream<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      for (let i: number; (i = buf.indexOf("\n\n")) >= 0; buf = buf.slice(i + 2)) {
        const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
  })().catch(() => {});
}, 30_000);

afterAll(() => {
  bridge?.kill();
  portal.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
async function until(ok: () => boolean, ms = 5_000): Promise<void> {
  for (const end = Date.now() + ms; !ok() && Date.now() < end; ) await Bun.sleep(50);
}

test("PATCH is validated as a whole before the unit changes; POST rejects a malformed loadout before creating anything", async () => {
  const bad = await call("PATCH", "/units/u-old", { team: 9, model: "gpt-6-sol", effort: "high", loadout: null });
  expect(bad.status).toBe(400);
  expect((await call("PATCH", "/units/u-old", { team: "x" })).status).toBe(400);
  expect((await call("PATCH", "/units/u-old", { model: 5 })).status).toBe(400);
  const same = await call("PATCH", "/units/u-old", {});
  expect(same.body).toMatchObject({ ok: true, model: "gpt-5.6-luna", effort: "low", loadout: null });
  await call("POST", "/units/u-old/send", { text: "ping", orderId: "o-v1" });
  await until(() => turns.some((t) => t.text.includes("order o-v1")));
  const order = turns.find((t) => t.text.includes("order o-v1"))!;
  expect(order.text).toContain("team 1");
  expect(order.text).not.toContain("team 9");
  expect(order).toMatchObject({ model: "gpt-5.6-luna", thinkingLevel: "low" });
  expect(order.text).toContain(NO_EDIT);
  const admin = await call("PATCH", "/units/u-old", { loadout: { instructions: "x", skills: ["raid-board", "admin"] } });
  expect(admin.status).toBe(400);
  expect(admin.body.error).toContain("admin");
  expect((await call("PATCH", "/units/u-old", {})).body.loadout).toBeNull();
  expect((await call("POST", "/units", { id: "u-bad2", loadout: { skills: ["send"] } })).status).toBe(400);

  const post = await call("POST", "/units", { id: "u-bad", name: "Bad", loadout: "invalid" });
  expect(post.status).toBe(400);
  expect(post.body.error).toContain("loadout");
  expect((await call("PATCH", "/units/u-bad", {})).status).toBe(404);
  expect(turns.some((t) => /-u-bad2?$/.test(t.threadRef))).toBe(false);
}, 15_000);

test("SOUL writes are gated by LOADOUT_SOUL for restored units: a non-matching unit keeps its scope but gets plan A only", async () => {
  // The restored agent SOUL write of u-old was dropped at boot.
  expect(turns.some((t) => t.text.includes("OLD SOUL WRITE"))).toBe(false);

  // u-old no longer matches: plan A, i.e. no QM turn for the change, only a bridge activity; its order keeps the scope.
  const loadout = { instructions: "Be brief.", skills: ["raid-board"], plugins: [] };
  expect((await call("PATCH", "/units/u-old", { loadout })).body.ok).toBe(true);
  await until(() => events.some((e) => e.unitId === "u-old" && e.kind === "message" && String(e.text).startsWith("Loadout changed:")));
  expect(events.find((e) => e.unitId === "u-old" && String(e.text).startsWith("Loadout changed:"))).toMatchObject({ type: "activity", text: 'Loadout changed: standing orders "Be brief." | skills raid-board | plugins gbrain' });
  await call("POST", "/units/u-old/send", { text: "ping", orderId: "o-a1" });
  await until(() => turns.some((t) => t.text.includes("order o-a1")));
  const a1 = turns.find((t) => t.text.includes("order o-a1"))!;
  expect(a1.scopeId).toBe("group:web-project-pb"); // session stays bound to its scope
  expect(a1.text).toContain("Standing orders: Be brief.");
  expect(turns.some((t) => t.threadRef.endsWith("-u-old") && t.text.includes("Loadout changed"))).toBe(false);
  expect(soulPuts).not.toContain("group:web-project-pb");

  // qmtest-a matches: admin SOUL write + read-back, one acknowledgement turn; the agent drifts the SOUL during that
  // turn, and the bridge re-writes it before the order queued behind it starts.
  expect((await call("PATCH", "/units/qmtest-a", { loadout })).body.ok).toBe(true);
  await call("POST", "/units/qmtest-a/send", { text: "ping", orderId: "o-b1" });
  await until(() => turns.some((t) => t.text.includes("order o-b1")));
  const ack = turns.find((t) => t.threadRef.endsWith("-qmtest-a") && t.text.includes("already applied"))!;
  expect(ack.scopeId).toBe("group:web-project-pa");
  expect(ack.text).toContain(NO_EDIT);
  const b1 = turns.find((t) => t.text.includes("order o-b1"))!;
  expect(b1.soulAtStart).toContain("Be brief.");
  expect(soulPuts.filter((x) => x === "group:web-project-pa")).toHaveLength(2); // write, then repair after the drift
  expect(out).toContain("BRIDGE WARN soul restored: qmtest-a");
  expect(projectsCreated).toBe(0); // restored projects are reused
}, 15_000);

test("soul guard: a plan A turn that changes the personal SOUL is followed by a restore of the startup baseline", async () => {
  expect(out).toContain("soul guard on: personal:emre baseline SOUL null");
  await call("POST", "/units/u-a/send", { text: "DRIFT-ME", orderId: "o-g1" });
  await until(() => soulPuts.includes("personal:emre"));
  expect(souls.get("personal:emre")).toBe(""); // a null baseline is restored as an empty SOUL (PUT needs a string)
  expect(out).toContain("BRIDGE WARN soul restored: personal:emre");
  // Back at baseline ("" counts as null): the next turn restores nothing.
  await call("POST", "/units/u-a/send", { text: "ping", orderId: "o-g2" });
  await until(() => events.some((e) => e.orderId === "o-g2" && e.type === "reply"));
  await Bun.sleep(200);
  expect(soulPuts.filter((x) => x === "personal:emre")).toHaveLength(1);
}, 15_000);
