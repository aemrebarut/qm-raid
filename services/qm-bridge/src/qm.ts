// Minimal QM client over the local dev portal (PORTAL_LOCAL_AUTH_BYPASS for loopback clients).
// The portal relays the web-ui API to QM core with its own signing, so this service holds no QM secrets.

export const PORTAL_URL = (process.env.QM_PORTAL_URL ?? "http://localhost:8129").replace(/\/$/, "");

export interface RunResult {
  status: string; // "ok" on success
  sessionId?: string;
  reply?: string;
  adminUrl?: string;
  error?: string;
  message?: string;
}

export interface RunState {
  status: string; // "queued" | "running" | "done" | "failed" | ...
  result: RunResult | null;
  partial?: string;
  activity?: Array<{ seq: number; type: string; payload: Record<string, unknown> }>;
}

async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${PORTAL_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      // Non-GET portal requests must look same-origin.
      ...(method !== "GET" ? { origin: PORTAL_URL } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`QM ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

let principalCache: string | null = null;

/** The local portal user (scopeId "personal:<principal>"). threadRefs must start with web:<principal>: */
export async function principal(): Promise<string> {
  if (principalCache) return principalCache;
  if (process.env.QM_PRINCIPAL) return (principalCache = process.env.QM_PRINCIPAL);
  const cfg = await api<{ scopeId?: string }>("GET", "/api/runtime-config");
  const p = cfg.scopeId?.startsWith("personal:") ? cfg.scopeId.slice("personal:".length) : "";
  if (!p) throw new Error(`cannot derive QM principal from runtime-config scopeId=${cfg.scopeId}`);
  return (principalCache = p);
}

export async function runtimeConfig(): Promise<{ approvedHarnesses?: string[]; modelsByHarness?: Record<string, string[]> }> {
  return api("GET", "/api/runtime-config");
}

export async function threadRefFor(key: string): Promise<string> {
  return `web:${await principal()}:raid-${key}`;
}

export interface TurnOptions {
  model?: string;
  thinkingLevel?: string;
  idempotencyKey?: string;
}

/** Queue a turn on a thread. Same threadRef = same QM session. */
export async function startTurn(threadRef: string, text: string, opts: TurnOptions = {}): Promise<{ runId: string; status: string }> {
  return api("POST", "/api/turn", { text, threadRef, ...opts });
}

export async function getRun(runId: string): Promise<RunState> {
  return api("GET", `/api/runs/${encodeURIComponent(runId)}`);
}

/** Poll a run until it leaves queued/running. */
export async function waitRun(runId: string, timeoutMs = 180_000, everyMs = 1500): Promise<RunState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(runId);
    if (run.status !== "running" && run.status !== "queued") return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status} after ${timeoutMs} ms`);
    await Bun.sleep(everyMs);
  }
}

export function sessionUrl(sessionId: string): string {
  return `${PORTAL_URL}/admin/history/s/${encodeURIComponent(sessionId)}`;
}
