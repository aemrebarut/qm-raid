// Minimal QM client over the local dev portal (PORTAL_LOCAL_AUTH_BYPASS for loopback clients).
// The portal relays the web-ui API to QM core with its own signing, so this service holds no QM secrets.

export const PORTAL_URL = (process.env.QM_PORTAL_URL ?? "http://localhost:8129").replace(/\/$/, "");

export interface RunResult {
  status: string; // ok | refused | failed | pending_approval | queued | silent | react
  sessionId?: string;
  reply?: string;
  reason?: string;
  refusalKind?: string;
  adminUrl?: string;
  error?: string;
  message?: string;
}

export interface RunState {
  status: string; // pending | running | done | failed
  result: RunResult | null;
  partial?: string;
  activity?: Array<{ seq: number; type: string; payload: Record<string, unknown> }>;
}

async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  // Retry once on a network error or 5xx when the call is safe to repeat (GET, or a POST carrying an idempotencyKey).
  const retryable = method === "GET" || (typeof body === "object" && body !== null && "idempotencyKey" in body);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${PORTAL_URL}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          // Non-GET portal requests must look same-origin.
          ...(method !== "GET" ? { origin: PORTAL_URL } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: signal ?? AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (retryable && attempt === 0 && !signal?.aborted) {
        await Bun.sleep(500);
        continue;
      }
      throw err;
    }
    const text = await res.text();
    if (res.status >= 500 && retryable && attempt === 0) {
      await Bun.sleep(500);
      continue;
    }
    if (!res.ok) throw new Error(`QM ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
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
  scopeId?: string; // group:web-project-<id> for a unit's own project scope (LOADOUT_SOUL)
}

/** Queue a turn on a thread. Same threadRef = same QM session. */
export async function startTurn(threadRef: string, text: string, opts: TurnOptions = {}): Promise<{ runId: string; status: string }> {
  return api("POST", "/api/turn", { text, threadRef, ...opts });
}

/** A QM project (own group scope with its own SOUL); used for per-unit loadouts behind LOADOUT_SOUL=1. */
export async function createProject(name: string): Promise<{ projectId: string; scopeId: string }> {
  const b = await api<any>("POST", "/api/projects", { name });
  const projectId = String(b?.id ?? b?.project?.id ?? "");
  if (!projectId) throw new Error(`POST /api/projects: no id in ${JSON.stringify(b).slice(0, 120)}`);
  return { projectId, scopeId: String(b?.scopeId ?? b?.project?.scopeId ?? `group:web-project-${projectId}`) };
}

export async function getRun(runId: string): Promise<RunState> {
  return api("GET", `/api/runs/${encodeURIComponent(runId)}`);
}

/** QM run statuses are pending | running | done | failed; a run is over once done/failed or its result is set. */
export function runFinished(run: RunState): boolean {
  return run.status === "done" || run.status === "failed" || run.result != null;
}

/** Poll a run until it is finished (done/failed or result set). */
export async function waitRun(runId: string, timeoutMs = 180_000, everyMs = 1500): Promise<RunState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await getRun(runId);
    if (runFinished(run)) return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} still ${run.status} after ${timeoutMs} ms`);
    await Bun.sleep(everyMs);
  }
}

/** The unit's conversation in QM's normal web UI (chats view deep link). */
export function sessionUrl(sessionId: string): string {
  return `${PORTAL_URL}/s/${encodeURIComponent(sessionId)}`;
}

/** The QM session id for a thread, once QM has created it (null before). */
export async function findSessionId(threadRef: string): Promise<string | null> {
  const { sessions } = await api<{ sessions: Array<{ id: string; threadRef?: string }> }>("GET", "/api/sessions");
  return sessions.find((s) => s.threadRef === threadRef)?.id ?? null;
}

export async function archiveSession(sessionId: string): Promise<void> {
  await api("POST", `/api/sessions/${encodeURIComponent(sessionId)}`, { archived: true });
}

/** Org-wide model spend so far (admin relay; the local portal user is org admin). Per-run token counts are not exposed. */
export async function orgSpend(): Promise<{ tokens: number; costUsd: number }> {
  const s = await api<{ org?: { tokens?: number; costUsd?: number } }>("GET", "/admin/api/spend");
  return { tokens: Number(s.org?.tokens ?? 0), costUsd: Number(s.org?.costUsd ?? 0) };
}
