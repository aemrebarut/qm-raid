// Spawn new issues, K13. Owner raid-eng-mock. Wired by app.ts as POST /api/targets (docs/CONTRACT.md).
// spawnTarget picks the component (given, or the least busy one), a free tile inside its zone, then calls brain
// POST /issues with that pos. The brain is the only allocator of issue and target ids (LUM-110 is t110), so the
// engine never sends an issue id and 4610 and 4618 never collide. No title = the brain draws the next pool issue.
// The brain's {target} is used unchanged: it joins store.state.targets and target.spawned {target} is emitted.
// Brain down or non-2xx = 503 and nothing is created (no local targets).
import type { Pos, State, Target } from "../../../contract/types.ts";
import { BRAIN_URL, GRID } from "./config.ts";
import { logOnce, sendJson } from "./http.ts";
import { emit, store } from "./store.ts";

export type SpawnResult = { ok: true; target: Target } | { ok: false; error: string; status: number };

const bad = (error: string, status = 400): SpawnResult => ({ ok: false, error, status });
const key = (p: Pos) => `${p.x},${p.y}`;

// Tiles of spawns waiting for the brain (tile -> component): a concurrent spawn never takes the same tile,
// and the least busy count includes them.
const reserved = new Map<string, string>();

// Mirrors game.ts blockedTile (not imported, to keep this module free of game.ts): a building's 3 x 3 footprint
// around its center tile and every zone border (walls on the board) are blocked.
function blocked(s: State, q: Pos): boolean {
  if (s.buildings.some((b) => Math.abs(b.x - q.x) <= 1 && Math.abs(b.y - q.y) <= 1)) return true;
  return s.components.some(({ zone: z }) =>
    q.x >= z.x && q.x < z.x + z.w && q.y >= z.y && q.y < z.y + z.h &&
    (q.x === z.x || q.x === z.x + z.w - 1 || q.y === z.y || q.y === z.y + z.h - 1));
}

const isFree = (s: State, q: Pos) =>
  !blocked(s, q) && !reserved.has(key(q)) && !s.targets.some((t) => t.pos.x === q.x && t.pos.y === q.y) && !s.units.some((u) => u.pos.x === q.x && u.pos.y === q.y);

// Least busy component: fewest open or engaged targets (pending spawns count too); ties keep world order.
export function leastBusy(s: State): string | null {
  const busy = (c: string) => s.targets.filter((t) => t.component === c && t.status !== "resolved").length + [...reserved.values()].filter((r) => r === c).length;
  let best: string | null = null, n = Infinity;
  for (const c of s.components) { const b = busy(c.id); if (b < n) { best = c.id; n = b; } }
  return best;
}

// The free interior tile of the zone farthest (Chebyshev) from every target, unit, building center and pending spawn;
// ties keep scan order (row by row). null when the zone has no free tile.
export function freeTileIn(s: State, component: string): Pos | null {
  const z = s.components.find((c) => c.id === component)?.zone;
  if (!z) return null;
  const others: Pos[] = [...s.targets.map((t) => t.pos), ...s.units.map((u) => u.pos), ...s.buildings.map((b) => ({ x: b.x, y: b.y })),
    ...[...reserved.keys()].map((k) => { const [x, y] = k.split(",").map(Number); return { x: x!, y: y! }; })];
  let best: Pos | null = null, bestGap = -1;
  for (let y = z.y + 1; y < z.y + z.h - 1; y++) for (let x = z.x + 1; x < z.x + z.w - 1; x++) {
    const q = { x, y };
    if (q.x < 0 || q.y < 0 || q.x >= GRID || q.y >= GRID || !isFree(s, q)) continue;
    const gap = Math.min(99, ...others.map((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y))));
    if (gap > bestGap) { best = q; bestGap = gap; }
  }
  return best;
}

// POST /api/targets {title?, body?, component?, kind?, severity?, customers?}.
// Errors: 400 bad input, 409 no free tile or an engine reset during the brain call, 503 brain down or non-2xx.
export async function spawnTarget(input: unknown): Promise<SpawnResult> {
  if (input !== undefined && input !== null && (typeof input !== "object" || Array.isArray(input))) return bad("body must be a JSON object");
  const b = (input ?? {}) as Record<string, unknown>;
  const s = store.state;
  if (b.title !== undefined && typeof b.title !== "string") return bad("title must be a string");
  if (b.body !== undefined && typeof b.body !== "string") return bad("body must be a string");
  if (b.component !== undefined && (typeof b.component !== "string" || !s.components.some((c) => c.id === b.component))) return bad(`unknown component ${String(b.component)}`);
  if (b.kind !== undefined && b.kind !== "bug" && b.kind !== "feature") return bad("kind must be bug or feature");
  const severity = b.severity === undefined ? undefined : Number(b.severity);
  if (severity !== undefined && ![1, 2, 3].includes(severity)) return bad("severity must be 1, 2 or 3");
  if (b.customers !== undefined && (!Array.isArray(b.customers) || b.customers.some((c) => typeof c !== "string"))) return bad("customers must be an array of customer ids");
  const title = typeof b.title === "string" ? b.title.trim().slice(0, 140) : "";

  const component = (b.component as string | undefined) ?? leastBusy(s);
  if (!component) return bad("no components in the world", 409);
  const pos = freeTileIn(s, component);
  if (!pos) return bad(`no free tile in the ${component} zone`, 409);

  // The component is always sent so the zone and the issue agree (the brain keeps it for pool issues too).
  const req: Record<string, unknown> = { pos, component };
  if (title) {
    req.title = title;
    if (typeof b.body === "string" && b.body.trim()) req.body = b.body.trim().slice(0, 2000);
    req.kind = b.kind ?? "bug";
    req.severity = severity ?? 2;
    if (b.customers) req.customers = b.customers;
  }

  reserved.set(key(pos), component);
  let res: { status: number; data: any };
  try {
    res = await sendJson<any>("POST", `${BRAIN_URL}/issues`, req, 5000);
  } finally {
    reserved.delete(key(pos));
  }

  if (res.status === 0) {
    logOnce("spawn:brain", `brain POST /issues unreachable at ${BRAIN_URL}; no target created`);
    return bad(`brain unreachable at ${BRAIN_URL}; no target created`, 503);
  }
  if (res.status < 200 || res.status >= 300) {
    logOnce("spawn:brain", `brain POST /issues failed (status ${res.status}); no target created`);
    return bad(`brain POST /issues failed (status ${res.status}${res.data?.error ? `: ${res.data.error}` : ""}); no target created`, 503);
  }
  const target = res.data?.target as Target | undefined; // the brain's full Target, used unchanged
  if (!target || typeof target.id !== "string" || typeof target.issue !== "string" || !target.pos || typeof target.component !== "string") {
    logOnce("spawn:shape", `brain POST /issues answered without a target: ${JSON.stringify(res.data).slice(0, 200)}`);
    return bad("brain answered without a target; no target created", 503);
  }

  // Engine reset during the brain call (store.state replaced): never push into the new world blindly. If the reset's
  // world load already has this target (the brain registered it), report that one; otherwise add nothing.
  if (store.state !== s) {
    const known = store.state.targets.find((x) => x.id === target.id);
    return known ? { ok: true, target: known } : bad("engine reset during the spawn; no target added", 409);
  }
  if (s.targets.some((x) => x.id === target.id)) return bad(`target ${target.id} already exists`, 409);
  s.targets.push(target);
  emit("target.spawned", { target });
  return { ok: true, target };
}
