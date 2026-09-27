// Small fetch helpers with timeouts; callers degrade on null instead of throwing.
export async function getJson<T = any>(url: string, timeoutMs = 3000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function sendJson<T = any>(method: string, url: string, body: unknown, timeoutMs = 5000): Promise<{ status: number; data: T | null }> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data: T | null = null;
    try { data = (await r.json()) as T; } catch { data = null; }
    return { status: r.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

// Throttled logging so a dead dependency does not flood the console.
const lastLog = new Map<string, number>();
export function logOnce(key: string, msg: string, everyMs = 60000): void {
  const now = Date.now();
  if ((lastLog.get(key) ?? 0) + everyMs > now) return;
  lastLog.set(key, now);
  console.warn(`[engine] ${msg}`);
}
