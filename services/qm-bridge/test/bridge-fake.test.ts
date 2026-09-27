// Bridge process against a fake QM portal (no QM needed): PATCH/POST validation happens before any change, and every
// plan B SOUL write is gated by LOADOUT_SOUL, restored units included. State goes to a temp dir (QM_BRIDGE_STATE_DIR),
// ports are ephemeral. Run: bun test test/bridge-fake.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Turn = { text: string; threadRef: string; model?: string; thinkingLevel?: string; scopeId?: string };
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
      const refs = [...new Set(turns.map((t) => t.threadRef)), "web:emre:raid-r1-qmtest-a", "web:emre:raid-r1-u-old"];
      return j({ sessions: refs.map((threadRef, i) => ({ id: `s${i}`, threadRef })) });
    }
    if (pathname === "/api/turn" && req.method === "POST") {
      turns.push((await req.json()) as Turn);
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

const unit = (id: string, scopeId: string, queue: unknown[] = []) => ({
  id,
  name: id,
  model: "gpt-5.6-luna",
  effort: "low",
  role: "worker",
  team: 1,
  scopeId,
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
      units: [unit("qmtest-a", "group:web-project-pa"), unit("u-old", "group:web-project-pb", [{ text: "OLD SOUL WRITE", intro: true, soul: true, key: "k-old" }])],
      retired: [],
      undelivered: [],
      projects: { "qmtest-a": { projectId: "pa", scopeId: "group:web-project-pa" }, "u-old": { projectId: "pb", scopeId: "group:web-project-pb" } },
    }),
  );
  bridge = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "server.ts")], {
    env: { ...process.env, PORT: "0", QM_PORTAL_URL: `http://127.0.0.1:${portal.port}`, QM_BRIDGE_STATE_DIR: dir, QM_THREAD_NS: "r1", QM_PRINCIPAL: "emre", LOADOUT_SOUL: "qmtest-" },
    stdout: "pipe",
    stderr: "ignore",
  });
  let out = "";
  let exited = false;
  void (async () => {
    const dec = new TextDecoder();
    for await (const chunk of bridge!.stdout as ReadableStream<Uint8Array>) out += dec.decode(chunk);
    exited = true;
  })();
  // Up once it listens and the model catalog loaded (restored queues are pumped then).
  await until(() => exited || out.includes("codex models"), 25_000);
  base = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? "";
  if (!base || !out.includes("codex models")) throw new Error(`bridge not up: ${out}`);
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

  const post = await call("POST", "/units", { id: "u-bad", name: "Bad", loadout: "invalid" });
  expect(post.status).toBe(400);
  expect(post.body.error).toContain("loadout");
  expect((await call("PATCH", "/units/u-bad", {})).status).toBe(404);
  expect(turns.some((t) => t.threadRef.endsWith("-u-bad"))).toBe(false);
}, 15_000);

test("SOUL writes are gated by LOADOUT_SOUL for restored units: a non-matching unit keeps its scope but gets plan A only", async () => {
  // The restored agent SOUL write of u-old was dropped at boot.
  expect(turns.some((t) => t.text.includes("OLD SOUL WRITE"))).toBe(false);

  const loadout = { instructions: "Be brief.", skills: [], plugins: [] };
  const old = await call("PATCH", "/units/u-old", { loadout });
  expect(old.body.ok).toBe(true);
  await until(() => turns.some((t) => t.threadRef.endsWith("-u-old") && t.text.startsWith("Loadout changed.")));
  const oldMarker = turns.find((t) => t.threadRef.endsWith("-u-old") && t.text.startsWith("Loadout changed."))!;
  expect(oldMarker.scopeId).toBe("group:web-project-pb"); // session stays bound to its scope
  expect(soulPuts).not.toContain("group:web-project-pb");
  expect(turns.some((t) => t.threadRef.endsWith("-u-old") && t.text.includes("/v1/soul"))).toBe(false);

  const a = await call("PATCH", "/units/qmtest-a", { loadout });
  expect(a.body.ok).toBe(true);
  await until(() => turns.some((t) => t.threadRef.endsWith("-qmtest-a") && t.text.startsWith("Loadout changed.")));
  expect(soulPuts).toEqual(["group:web-project-pa"]);
  expect(souls.get("group:web-project-pa")).toContain("Be brief.");
  expect(turns.find((t) => t.threadRef.endsWith("-qmtest-a") && t.text.startsWith("Loadout changed."))!.scopeId).toBe("group:web-project-pa");
  expect(projectsCreated).toBe(0); // restored projects are reused
}, 15_000);
