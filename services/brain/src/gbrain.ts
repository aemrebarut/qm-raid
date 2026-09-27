// One long-lived `gbrain serve` (stdio MCP) child. This process is the only owner of the game brain.
// All tool calls are serialized through one queue (PGLite is single-writer).

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer };

const CALL_TIMEOUT_MS = 15000;
let child: ReturnType<typeof Bun.spawn> | null = null;
let ready: Promise<void> | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();
let queue: Promise<unknown> = Promise.resolve();

function childEnv() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // The dev brain wrapper sets GBRAIN_HOME; the game brain uses the default ~/.gbrain unless BRAIN_GBRAIN_HOME is set.
  delete env.GBRAIN_HOME;
  if (process.env.BRAIN_GBRAIN_HOME) env.GBRAIN_HOME = process.env.BRAIN_GBRAIN_HOME;
  return env;
}

function send(msg: object) {
  (child!.stdin as any).write(JSON.stringify(msg) + "\n");
}

function request(method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`gbrain ${method} timed out`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function readLoop(proc: NonNullable<typeof child>) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buf += dec.decode(chunk);
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: any;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id === undefined || !pending.has(m.id)) continue;
      const p = pending.get(m.id)!;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(m.error.message ?? "gbrain error"));
      else p.resolve(m.result);
    }
  }
}

function start(): Promise<void> {
  const proc = Bun.spawn(["gbrain", "serve"], { stdin: "pipe", stdout: "pipe", stderr: "ignore", env: childEnv() });
  child = proc;
  console.log(`[brain] gbrain serve child pid ${proc.pid}`);
  readLoop(proc).catch(() => {});
  proc.exited.then((code) => {
    console.log(`[brain] gbrain serve exited (${code}); will restart on next call`);
    if (child === proc) { child = null; ready = null; }
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error("gbrain child exited")); pending.delete(id); }
  });
  return request("initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "qm-raid-brain", version: "0.1" },
  }).then(() => send({ jsonrpc: "2.0", method: "notifications/initialized" }));
}

function ensure(): Promise<void> {
  if (!ready) ready = start().catch((e) => { ready = null; throw e; });
  return ready;
}

export function childPid(): number | null {
  return child?.pid ?? null;
}

// Raw JSON-RPC passthrough for the MCP facade (serialized with everything else).
export function rpc(method: string, params: object): Promise<any> {
  const run = queue.then(async () => { await ensure(); return request(method, params); });
  queue = run.catch(() => {});
  return run;
}

// Call a gbrain tool and parse its JSON text result.
export async function tool<T = any>(name: string, args: object = {}): Promise<T> {
  const res = await rpc("tools/call", { name, arguments: args });
  const text = res?.content?.[0]?.text ?? "";
  if (res?.isError) throw new Error(`gbrain ${name}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

export function stop() {
  child?.kill();
}
