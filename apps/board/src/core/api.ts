// Engine API client. Every call resolves (never throws): {ok: false, error} on network or HTTP failure.
// All paths are relative to the board origin; Vite proxies /api to the engine on 4610.
import type { State, Workflow, Team } from "./types";

export type Reply<T = {}> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON reply */ }
    if (!res.ok) return { ok: false, error: json?.error ?? `${res.status} ${res.statusText}` };
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return json.ok === false ? { ok: false, error: json.error ?? "error" } : ({ ok: true, ...json } as Reply<T>);
    }
    return { ok: true, data: json } as unknown as Reply<T>;
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

export interface GraphNode { id: string; type: string; title: string }
export interface GraphEdge { from: string; to: string; type: string }
export interface SearchHit { slug: string; title: string; snippet: string }

export const api = {
  get: <T = {}>(path: string) => call<T>("GET", path),
  post: <T = {}>(path: string, body?: unknown) => call<T>("POST", path, body ?? {}),
  patch: <T = {}>(path: string, body: unknown) => call<T>("PATCH", path, body),

  async state(): Promise<State | null> {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) return null;
      const s = await res.json();
      return s && Array.isArray(s.units) ? (s as State) : null;
    } catch { return null; }
  },

  // Orders
  order: (body: { unitIds?: string[]; teamId?: number; targetId: string }) => call("POST", "/api/orders", body),
  cancelOrder: (id: string) => call("POST", `/api/orders/${encodeURIComponent(id)}/cancel`, {}),
  goOrder: (id: string) => call("POST", `/api/orders/${encodeURIComponent(id)}/go`, {}),
  adjustOrder: (id: string, body: { unitId?: string; targetId?: string }) => call("POST", `/api/orders/${encodeURIComponent(id)}/adjust`, body),

  // Units
  spawn: (body: { class: string; name?: string; team?: number }) => call<{ unit?: unknown }>("POST", "/api/units", body),
  patchUnit: (id: string, body: { team?: number | null; effort?: string; role?: string; autonomy?: string }) =>
    call("PATCH", `/api/units/${encodeURIComponent(id)}`, body),
  retire: (id: string) => call("DELETE", `/api/units/${encodeURIComponent(id)}`),
  message: (unitId: string, text: string) => call("POST", `/api/units/${encodeURIComponent(unitId)}/message`, { text }),

  // Teams
  assignTeam: (id: number, members: string[]) => call("POST", "/api/teams", { id, members }),
  patchTeam: (id: number, body: { autopilot?: boolean; name?: string }) => call("PATCH", `/api/teams/${id}`, body),
  /** Team workflow: a preset (engine assigns members to roles in member order) or a full graph. */
  setWorkflow: (id: number, body: { preset: Workflow["preset"] } | { workflow: Workflow }) => call<{ team?: Team }>("PUT", `/api/teams/${id}/workflow`, body),
  clearWorkflow: (id: number) => call<{ team?: Team }>("DELETE", `/api/teams/${id}/workflow`),

  // Forge (River building)
  forgeType: (name: string, description: string) => call<{ typeId?: string }>("POST", "/api/forge/types", { name, description }),

  // Library (GBrain) proxies
  graph: () => call<{ nodes: GraphNode[]; edges: GraphEdge[] }>("GET", "/api/brain/graph"),
  search: (q: string) => call<{ data: SearchHit[] }>("GET", `/api/brain/search?q=${encodeURIComponent(q)}`),
  page: (slug: string) => call<{ slug: string; title: string; body: string }>("GET", `/api/brain/page?slug=${encodeURIComponent(slug)}`),
  brainStats: () => call<{ pages: number }>("GET", "/api/brain/stats"),

  reset: () => call("POST", "/api/reset", {}),
};

export type Api = typeof api;
