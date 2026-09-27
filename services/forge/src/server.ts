// Forge: the River building. Trains new unit types (POST/GET /types) by running
// the Python pipeline in river/ as a child process, one per type.
// Later milestones: forge units implement the Bridge API on this same port.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { commanderModel, propose } from "./commander";
import { createModelServer } from "./model";
import { createUnits } from "./units";

type Status = "generating" | "training" | "evaluating" | "ready" | "failed";
interface ForgeType {
  id: string; name: string; description: string; status: Status; progress: number; stage: string;
  examples: number; evalScore: number | null; model: string | null; createdAt: number;
  baseModel: string | null; // internal: River base model of the checkpoint, used to serve forge units
  dryRun: boolean; // internal: forced dry run (smoke tests), never touches River
  pid?: number | null; // internal: pipeline child while it runs
}

const PORT = Number(process.env.FORGE_PORT ?? 4612);
const RIVER_DIR = resolve(import.meta.dir, "../../../river");
const RUNS_DIR = join(RIVER_DIR, "runs");
const STORE = join(RUNS_DIR, "types.json");
const PYTHON = join(RIVER_DIR, ".venv/bin/python");
// dry: fake training, real synthetic data. river: real River SFT. Default: river when RIVER_API_KEY is set
// (Bun loads services/forge/.env when started from services/forge), else dry. FORGE_MODE overrides.
const MODE = process.env.FORGE_MODE === "dry" || process.env.FORGE_MODE === "river"
  ? process.env.FORGE_MODE : process.env.RIVER_API_KEY ? "river" : "dry";
const DRY_SECONDS = Number(process.env.FORGE_DRY_SECONDS ?? 60);

const types = new Map<string, ForgeType>();

function save() {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(STORE, JSON.stringify([...types.values()], null, 2));
  } catch (e) { console.error("[forge] save failed", e); }
}

function load() {
  if (!existsSync(STORE)) return;
  try {
    for (const t of JSON.parse(readFileSync(STORE, "utf8")) as ForgeType[]) {
      types.set(t.id, t);
      if (t.status !== "ready" && t.status !== "failed") {
        if (t.pid && alive(t.pid)) { console.log(`[forge] re-attaching to ${t.id} (pid ${t.pid})`); follow(t).catch((e) => console.error("[forge] follow", e)); }
        else { t.status = "failed"; t.stage = "interrupted by a forge restart"; }
      }
    }
  } catch (e) { console.error("[forge] load failed", e); }
}

// Always prefixed so a forged type can never collide with builtin classes (knight, ranger, scout, oracle).
function slugify(name: string): string {
  const base = "forge-" + (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "type");
  let id = base, n = 2;
  while (types.has(id)) id = `${base}-${n++}`;
  return id;
}

function publicType(t: ForgeType) {
  const { createdAt, baseModel, dryRun, pid, ...rest } = t;
  return rest;
}

const alive = (pid?: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

// The pipeline child writes JSON progress lines to runs/<id>/progress.jsonl (a file, not a pipe), so it keeps
// running across a forge restart; the forge tails the file and re-attaches by PID on start.
async function follow(t: ForgeType) {
  const file = join(RUNS_DIR, t.id, "progress.jsonl");
  let offset = 0, buf = "";
  const decoder = new TextDecoder();
  while (true) {
    const done = !alive(t.pid);
    try {
      const f = Bun.file(file);
      if (f.size > offset) {
        buf += decoder.decode(new Uint8Array(await f.slice(offset).arrayBuffer()), { stream: true });
        offset = f.size;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const u = JSON.parse(line);
            for (const k of ["status", "progress", "stage", "examples", "evalScore", "model", "baseModel"] as const) {
              if (k in u) (t as any)[k] = u[k];
            }
          } catch { console.error("[forge] bad pipeline line", line.slice(0, 200)); }
        }
        save();
      }
    } catch {}
    if (t.status === "ready" || t.status === "failed") break;
    if (done) { Object.assign(t, { status: "failed", stage: "pipeline exited without finishing" }); break; }
    await Bun.sleep(700);
  }
  t.pid = null;
  save();
  console.log(`[forge] type ${t.id} finished: ${t.status} (${t.stage})`);
}

function runPipeline(t: ForgeType) {
  const out = join(RUNS_DIR, t.id);
  mkdirSync(out, { recursive: true });
  const progress = join(out, "progress.jsonl");
  writeFileSync(progress, "");
  const args = [PYTHON, "-m", "forge.pipeline", "--type-id", t.id, "--name", t.name, "--description", t.description, "--out", out];
  if (MODE === "dry" || t.dryRun) args.push("--dry-run", "--dry-seconds", String(DRY_SECONDS));
  try {
    const proc = Bun.spawn(args, { cwd: RIVER_DIR, stdout: Bun.file(progress), stderr: Bun.file(join(out, "pipeline.log")), stdin: "ignore", env: process.env });
    proc.unref();
    t.pid = proc.pid;
    save();
  } catch (e) {
    Object.assign(t, { status: "failed", stage: `could not start pipeline: ${String(e).slice(0, 120)}` });
    save();
    return;
  }
  follow(t).catch((e) => console.error("[forge] follow", e));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

load();

const modelServer = createModelServer(RIVER_DIR);
const units = createUnits({
  types: () => [...types.values()].map((t) => ({ id: t.id, name: t.name, description: t.description, status: t.status, model: t.model, baseModel: t.baseModel ?? null })),
  ask: (r) => modelServer.ask(r),
});

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 255, // SSE on /events; pings every 15 s
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      const bridge = await units.handle(req, url);
      if (bridge) return bridge;
      if (req.method === "GET" && path === "/health") return json({ ok: true, service: "forge", mode: MODE });
      if (req.method === "GET" && path === "/types") return json([...types.values()].map(publicType));
      if (req.method === "POST" && path === "/propose") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") return json({ ok: false, error: "json body required", proposals: [] }, 400);
        return json({ proposals: propose(body) });
      }
      if (req.method === "GET" && path === "/commander") {
        const m = commanderModel();
        const weights = Object.fromEntries(Object.entries(m.w).filter(([, v]) => Math.abs(v) > 0.01).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])));
        return json({ vetoRows: m.rows, examples: m.examples, trainedAt: m.trainedAt || null, weights });
      }
      if (req.method === "POST" && path === "/types") {
        const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string; dryRun?: boolean };
        const name = String(body.name ?? "").trim();
        const description = String(body.description ?? "").trim();
        if (!name || !description) return json({ ok: false, error: "name and description are required" }, 400);
        const t: ForgeType = { id: slugify(name), name: name.slice(0, 60), description: description.slice(0, 600),
          status: "generating", progress: 0, stage: "queued", examples: 0, evalScore: null, model: null, createdAt: Date.now(),
          baseModel: null, dryRun: body.dryRun === true };
        types.set(t.id, t);
        save();
        runPipeline(t);
        return json({ ok: true, typeId: t.id });
      }
      if (req.method === "DELETE" && path.startsWith("/types/")) {
        // Cleanup of test types; stops a running pipeline (our own child, by exact PID).
        const t = types.get(decodeURIComponent(path.slice(7)));
        if (!t) return json({ ok: false, error: "no such type" }, 404);
        if (t.pid && alive(t.pid)) { try { process.kill(t.pid); } catch {} }
        types.delete(t.id);
        save();
        return json({ ok: true });
      }
      if (req.method === "GET" && path.startsWith("/types/")) {
        const t = types.get(decodeURIComponent(path.slice(7)));
        return t ? json(publicType(t)) : json({ ok: false, error: "no such type" }, 404);
      }
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      console.error("[forge] error", e);
      return json({ ok: false, error: String(e) }, 500);
    }
  },
});

console.log(`[forge] listening on http://127.0.0.1:${PORT} (mode ${MODE})`);
