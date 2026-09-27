// Unit loadout (docs/CONTRACT.md "Loadout"): system prompt / standing orders, skills, plugins, model, effort. Owner raid-eng-mock.
// GET /api/catalog[?unitId=] -> the unit's bridge GET /catalog (built-in classes: BRIDGE_URL, forged types: the Forge);
// without unitId the main bridge's catalog. PATCH /api/units/:id {instructions?, skills?, plugins?, model?, effort?}
// -> bridge PATCH /units/:id {loadout?, model?, effort?} (the full merged loadout), stores the result, emits unit.updated.
import type { CatalogItem, Loadout, Unit } from "../../../contract/types.ts";
import { bridgeFor } from "./bridge.ts";
import { BRIDGE_URL } from "./config.ts";
import { defaultLoadout } from "./fixture.ts";
import { getJson, logOnce, sendJson } from "./http.ts";
import { emit, store } from "./store.ts";

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const EFFORTS = ["low", "medium", "high"];
const MAX_INSTRUCTIONS = 4000;
const MAX_IDS = 40;

export async function getCatalog(unitId?: string | null): Promise<{ ok: true; items: CatalogItem[] } | Fail> {
  let base = BRIDGE_URL;
  if (unitId) {
    const u = store.state.units.find((x) => x.id === unitId);
    if (!u) return fail(404, `unknown unit ${unitId}`);
    base = bridgeFor(u);
  }
  const r = await getJson<{ items?: unknown }>(`${base}/catalog`, 3000);
  if (!r || !Array.isArray(r.items)) {
    logOnce(`catalog:${base}`, `catalog unavailable at ${base}/catalog`);
    return fail(503, `catalog unavailable at ${base}`);
  }
  const items: CatalogItem[] = [];
  for (const x of r.items as any[]) {
    if (!x || typeof x.id !== "string" || !x.id || (x.kind !== "skill" && x.kind !== "plugin")) continue;
    items.push({ id: x.id, name: typeof x.name === "string" && x.name ? x.name : x.id, description: typeof x.description === "string" ? x.description : "", kind: x.kind });
  }
  return { ok: true, items };
}

const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length <= MAX_IDS && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 80) ? [...new Set(v as string[])] : null;
const isLoadout = (v: any): v is Loadout => !!v && typeof v.instructions === "string" && ids(v.skills) !== null && ids(v.plugins) !== null;

export type LoadoutPatch = { instructions?: unknown; skills?: unknown; plugins?: unknown; model?: unknown; effort?: unknown };

// ensureSpawned (from game.ts, optional): units register with the bridge lazily, so a 404 from the bridge registers
// the unit and retries once.
export async function patchLoadout(unitId: string, body: unknown, ensureSpawned?: (u: Unit) => Promise<boolean>): Promise<{ ok: true; unit: Unit; notes?: string[] } | Fail> {
  const u = store.state.units.find((x) => x.id === unitId);
  if (!u) return fail(404, `unknown unit ${unitId}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "json body required");
  const b = body as LoadoutPatch;
  const cur = isLoadout(u.loadout) ? u.loadout : defaultLoadout();
  const next: Loadout = { instructions: cur.instructions, skills: [...cur.skills], plugins: [...cur.plugins] };
  if (b.instructions !== undefined) {
    if (typeof b.instructions !== "string" || b.instructions.length > MAX_INSTRUCTIONS) return fail(400, `instructions must be a string of at most ${MAX_INSTRUCTIONS} characters`);
    next.instructions = b.instructions;
  }
  for (const k of ["skills", "plugins"] as const) {
    if (b[k] === undefined) continue;
    const v = ids(b[k]);
    if (!v) return fail(400, `${k} must be an array of at most ${MAX_IDS} ids`);
    next[k] = v;
  }
  if (b.model !== undefined && (typeof b.model !== "string" || !b.model.trim() || b.model.length > 80)) return fail(400, "model must be a non-empty string");
  if (b.effort !== undefined && !EFFORTS.includes(b.effort as string)) return fail(400, "effort must be low, medium or high");
  const loadoutChanged = b.instructions !== undefined || b.skills !== undefined || b.plugins !== undefined;
  if (!loadoutChanged && b.model === undefined && b.effort === undefined) return fail(400, "nothing to change: send instructions, skills, plugins, model or effort");

  const req: { loadout?: Loadout; model?: string; effort?: string } = {};
  if (loadoutChanged) req.loadout = next;
  if (b.model !== undefined) req.model = (b.model as string).trim();
  if (b.effort !== undefined) req.effort = b.effort as string;
  const base = bridgeFor(u);
  const url = `${base}/units/${encodeURIComponent(u.id)}`;
  let r = await sendJson<any>("PATCH", url, req, 20000);
  if (r.status === 404 && ensureSpawned && store.state.units.includes(u) && (await ensureSpawned(u))) r = await sendJson<any>("PATCH", url, req, 20000);
  // reset or retire during the await: the unit object is no longer in the live state
  if (!store.state.units.includes(u)) return fail(409, "unit is gone (engine reset or retired) while applying the loadout");
  if (r.status === 0 || r.status >= 500) {
    logOnce(`loadout:${base}`, `loadout PATCH failed at ${base} (status ${r.status})`);
    return fail(503, `bridge unavailable at ${base}`);
  }
  if (r.status < 200 || r.status >= 300 || r.data?.ok === false) {
    const error = typeof r.data?.error === "string" ? r.data.error : `bridge refused the loadout (status ${r.status})`;
    return fail(r.status >= 400 && r.status < 500 ? r.status : 400, error);
  }
  // store what the bridge applied when it says so, else what we asked for
  if (loadoutChanged) u.loadout = isLoadout(r.data?.loadout) ? { instructions: r.data.loadout.instructions, skills: ids(r.data.loadout.skills)!, plugins: ids(r.data.loadout.plugins)! } : next;
  if (req.model !== undefined) u.model = typeof r.data?.model === "string" && r.data.model ? r.data.model : req.model;
  if (req.effort !== undefined) u.effort = typeof r.data?.effort === "string" && EFFORTS.includes(r.data.effort) ? r.data.effort : req.effort;
  emit("unit.updated", { unit: u });
  const notes = Array.isArray(r.data?.notes) ? (r.data.notes as unknown[]).filter((n): n is string => typeof n === "string") : [];
  return notes.length ? { ok: true, unit: u, notes } : { ok: true, unit: u };
}

// After a unit (re)registers with a bridge that lost its config (bridge restart), push the stored loadout again.
// Optional for game.ts: call after ensureSpawned succeeds when the unit's loadout is not the default.
export async function reapplyLoadout(u: Unit): Promise<void> {
  const l = u.loadout;
  if (!isLoadout(l)) return;
  const d = defaultLoadout();
  if (l.instructions === d.instructions && l.skills.length === 0 && l.plugins.join(",") === d.plugins.join(",")) return;
  await sendJson("PATCH", `${bridgeFor(u)}/units/${encodeURIComponent(u.id)}`, { loadout: l }, 20000);
}
