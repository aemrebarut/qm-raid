// Forge (River building) client, E12. Owner raid-eng-mock.
// Polls GET $FORGE_URL/types every 2 s, merges forged unit types into state.unitTypes after the builtins,
// emits forge.updated {unitType} only on change, and proxies POST /api/forge/types.
// Forge down: keep the last list, log once a minute, never throw.
import type { UnitType } from "../../../contract/types.ts";
import { FORGE_URL } from "./config.ts";
import { getJson, logOnce, sendJson } from "./http.ts";
import { emit, store } from "./store.ts";

const POLL_MS = 2000;
const STATUSES = new Set<UnitType["status"]>(["generating", "training", "evaluating", "ready", "failed"]);

type RawType = { id?: unknown; name?: unknown; status?: unknown; progress?: unknown; stage?: unknown; model?: unknown };

function toUnitType(r: RawType): UnitType | null {
  if (!r || typeof r.id !== "string" || !r.id) return null;
  const p = Number(r.progress);
  return {
    id: r.id,
    name: typeof r.name === "string" && r.name ? r.name : r.id,
    source: "forge",
    status: STATUSES.has(r.status as UnitType["status"]) ? (r.status as UnitType["status"]) : "generating",
    progress: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0,
    stage: typeof r.stage === "string" ? r.stage : "",
    model: typeof r.model === "string" && r.model ? r.model : null,
  };
}

const same = (a: UnitType, b: UnitType) =>
  a.name === b.name && a.status === b.status && a.progress === b.progress && a.stage === b.stage && a.model === b.model;

let polling = false;
let down = false;

export async function pollForge(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const list = await getJson<RawType[]>(`${FORGE_URL}/types`, 1500);
    const builtins = store.state.unitTypes.filter((t) => t.source !== "forge");
    const prev = store.state.unitTypes.filter((t) => t.source === "forge");
    if (!Array.isArray(list)) {
      down = true;
      logOnce("forge", `forge unreachable at ${FORGE_URL}/types; keeping ${prev.length} forged types`);
      return;
    }
    if (down) { down = false; console.log(`[engine] forge back at ${FORGE_URL}`); }

    const taken = new Set(builtins.map((t) => t.id)); // a forged type never shadows a builtin class
    const next: UnitType[] = [];
    for (const raw of list) {
      const t = toUnitType(raw);
      if (!t || taken.has(t.id)) continue;
      taken.add(t.id);
      next.push(t);
    }
    // A type that vanished from a running Forge (Forge restarted) stays listed as failed, so units and UI stay consistent.
    for (const p of prev) {
      if (!taken.has(p.id)) next.push(p.status === "failed" && p.stage === "gone from the Forge" ? p : { ...p, status: "failed", stage: "gone from the Forge" });
    }
    store.state.unitTypes = [...builtins, ...next];
    const before = new Map(prev.map((t) => [t.id, t]));
    for (const t of next) {
      const b = before.get(t.id);
      if (!b || !same(b, t)) emit("forge.updated", { unitType: t });
    }
  } catch (e) {
    logOnce("forge-err", `forge poll failed: ${e}`);
  } finally {
    polling = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

// Idempotent. Polls at once, then every 2 s. Returns a stop function.
export function startForge(): () => void {
  if (!timer) {
    void pollForge();
    timer = setInterval(() => void pollForge(), POLL_MS);
  }
  return () => { if (timer) clearInterval(timer); timer = null; };
}

// POST /api/forge/types {name, description, dryRun?} -> POST $FORGE_URL/types
// dryRun: true (Forge extension) forces the 60 s fake pipeline; without it a Forge in river mode starts real, paid training.
export async function forgeProxy(body: unknown): Promise<{ ok: true; typeId: string } | { ok: false; error: string }> {
  const b = (body && typeof body === "object" ? body : {}) as { name?: unknown; description?: unknown; dryRun?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (!name || !description) return { ok: false, error: "name and description required" };
  const payload = b.dryRun !== undefined ? { name, description, dryRun: b.dryRun } : { name, description }; // dryRun forwarded unchanged
  const r = await sendJson<{ typeId?: unknown; error?: unknown }>("POST", `${FORGE_URL}/types`, payload, 8000);
  if (r.status === 0) { logOnce("forge", `forge unreachable at ${FORGE_URL}/types`); return { ok: false, error: `forge unreachable at ${FORGE_URL}` }; }
  if (r.status >= 400 || typeof r.data?.typeId !== "string") {
    return { ok: false, error: typeof r.data?.error === "string" ? r.data.error : `forge answered ${r.status}` };
  }
  void pollForge(); // show the new type without waiting for the next tick
  return { ok: true, typeId: r.data.typeId };
}

// A forged unit type by id (null for builtins and unknown ids).
export function forgeType(id: string): UnitType | null {
  return store.state.unitTypes.find((t) => t.id === id && t.source === "forge") ?? null;
}
