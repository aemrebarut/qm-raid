// Brain service: the game world and GBrain game memory over HTTP (docs/CONTRACT.md, Brain API).
import { tool, childPid } from "./gbrain.ts";
import { loadWorld, issueSlug, BRAIN_DIR, WORLD_DIR } from "./world.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startMcp } from "./mcp.ts";
import type { Target } from "../../../contract/types.ts";

const PORT = Number(process.env.BRAIN_PORT ?? 4616);
const MCP_PORT = Number(process.env.BRAIN_MCP_PORT ?? 4617);
const HOST = "127.0.0.1";
// Leftovers from the pre-hackathon smoke test; not part of the Lumen world.
const HIDDEN = new Set(["people/sam-ortiz", "meetings/2026-09-20-acme-kickoff"]);

const json = (body: unknown, status = 200) => Response.json(body, { status });
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

type Link = { from_slug: string; to_slug: string; link_type: string };
type PageRow = { slug: string; type: string; title: string };

async function getPage(slug: string): Promise<{ slug: string; title: string; type: string; body: string; fm: Record<string, any> } | null> {
  try {
    const p = await tool<any>("get_page", { slug });
    if (!p || typeof p !== "object" || !p.slug) return null;
    return { slug: p.slug, title: p.title ?? slug, type: p.type ?? "", body: p.compiled_truth ?? "", fm: p.frontmatter ?? {} };
  } catch {
    return null;
  }
}

// list_pages returns at most 100 rows per call, so page through with offset.
async function listAll(filter: { type?: string } = {}): Promise<PageRow[]> {
  const out: PageRow[] = [];
  for (let offset = 0; offset < 20000; offset += 100) {
    const rows = await tool<PageRow[]>("list_pages", { ...filter, limit: 100, offset, sort: "updated_asc" });
    if (!Array.isArray(rows)) break;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return [...new Map(out.map((r) => [r.slug, r])).values()];
}

async function listPages(): Promise<PageRow[]> {
  return (await listAll()).filter((r) => !HIDDEN.has(r.slug));
}

// Write lock: each mutation's whole read-modify-write runs alone (the gbrain queue only orders single RPCs).
let writeChain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn);
  writeChain = run.catch(() => {});
  return run;
}

// gbrain's serve only sweeps wikilinks into links at startup or after about 10 idle minutes, so this service
// reads wikilinks from page bodies itself: /graph and recall see a new learning's links at once.
const WIKILINK = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
function wikilinks(body: string): string[] {
  return [...new Set([...body.matchAll(WIKILINK)].map((m) => m[1].trim()))];
}
function dropPrefix(title: string): string {
  return title.replace(/^[A-Z]+-\d+:\s*/, "");
}
const slugMs = (s: string) => Number(s.split("-").pop()) || 0;

// Newest learnings whose body links the component or the issue.
async function learningsFor(comp: string | undefined, issue: string | undefined): Promise<string[]> {
  const rows = await listAll({ type: "learning" }).catch(() => [] as PageRow[]);
  const out: string[] = [];
  for (const slug of rows.map((r) => r.slug).sort((a, b) => slugMs(b) - slugMs(a)).slice(0, 40)) {
    const p = await getPage(slug);
    if (!p) continue;
    const links = wikilinks(p.body);
    if ((comp && links.includes(`components/${comp}`)) || (issue && links.includes(issue))) out.push(slug);
    if (out.length >= 6) break;
  }
  return out;
}

// Library panel node types, from the slug prefix (gbrain types lump components and rules together as concept).
const PREFIX_TYPES: Record<string, string> = {
  components: "component", rules: "rule", issues: "issue", companies: "company",
  people: "person", learnings: "learning", units: "unit",
};
function nodeType(p: PageRow): string {
  if (p.slug === "lumen") return "product";
  return PREFIX_TYPES[p.slug.split("/")[0]] ?? p.type;
}

// Layout targets first; a spawned target t<n> is issue LUM-<n>, read from its page issues/lum-<n> (pos in frontmatter).
async function targetFromPage(slug: string): Promise<Target | undefined> {
  const m = /^issues\/lum-(\d+)$/.exec(slug);
  if (!m) return undefined;
  const page = await getPage(slug);
  if (!page) return undefined;
  const links = wikilinks(page.body);
  const component = String(page.fm.component ?? links.find((l) => l.startsWith("components/"))?.slice("components/".length) ?? "");
  if (!component) return undefined;
  const sev = Number(page.fm.severity);
  return {
    id: `t${m[1]}`, issue: `LUM-${m[1]}`, title: dropPrefix(page.title), component,
    kind: page.fm.kind === "feature" ? "feature" : "bug", severity: ([1, 2, 3].includes(sev) ? sev : 2) as Target["severity"],
    status: "open", pos: { x: Number(page.fm.pos_x) || 0, y: Number(page.fm.pos_y) || 0 },
    customers: [...new Set(links.filter((l) => l.startsWith("companies/")).map((l) => l.slice("companies/".length)))],
  };
}

async function resolveTarget(targetId?: string): Promise<Target | undefined> {
  if (!targetId) return undefined;
  const fromLayout = loadWorld().targets.find((t) => t.id === targetId);
  if (fromLayout) return fromLayout;
  const m = /^(?:t|lum-)(\d+)$/i.exec(targetId);
  return m ? targetFromPage(`issues/lum-${m[1]}`) : undefined;
}

// Spawned targets (issue pages not in world/brain), for GET /world.
async function spawnedTargets(): Promise<Target[]> {
  const worldSlugs = new Set(worldFiles().map((f) => f.slug));
  const out: Target[] = [];
  for (const r of await listAll({ type: "issue" })) {
    if (worldSlugs.has(r.slug)) continue;
    const t = await targetFromPage(r.slug);
    if (t) out.push(t);
  }
  return out.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

let graphCache: { nodes: any[]; edges: any[] } | null = null;
let graphAt = 0;
// A build that started before a write must not cache its (stale) result.
let graphGen = 0;
function invalidateGraph() {
  graphCache = null;
  graphGen++;
}
const GRAPH_TTL_MS = 10000;

async function graph() {
  if (graphCache && Date.now() - graphAt < GRAPH_TTL_MS) return graphCache;
  const gen = graphGen;
  const pages = await listPages();
  const known = new Set(pages.map((p) => p.slug));
  const edges: { from: string; to: string; type: string }[] = [];
  for (const p of pages) {
    const links = await tool<Link[]>("get_links", { slug: p.slug });
    for (const l of links) if (known.has(l.to_slug)) edges.push({ from: l.from_slug, to: l.to_slug, type: l.link_type });
    // Wikilinks not yet swept into gbrain links.
    const page = await getPage(p.slug);
    for (const to of wikilinks(page?.body ?? "")) {
      if (known.has(to) && to !== p.slug && !edges.some((e) => e.from === p.slug && e.to === to)) edges.push({ from: p.slug, to, type: "mentions" });
    }
  }
  const built = { nodes: pages.map((p) => ({ id: p.slug, type: nodeType(p), title: p.title })), edges };
  if (gen === graphGen) {
    graphCache = built;
    graphAt = Date.now();
  }
  return built;
}

async function recall(componentId?: string, targetId?: string, query?: string) {
  const world = loadWorld();
  const target = await resolveTarget(targetId);
  const comp = componentId ?? target?.component;
  const slugs: string[] = [];
  const add = (s: string) => { if (s && !slugs.includes(s)) slugs.push(s); };
  const pages = new Map<string, NonNullable<Awaited<ReturnType<typeof getPage>>>>();
  const load = async (s: string) => {
    if (!pages.has(s)) { const p = await getPage(s); if (p) pages.set(s, p); }
    return pages.get(s);
  };
  // Component and its house rules (rules read from the page's wikilinks).
  if (comp) {
    const c = await load(`components/${comp}`);
    if (c) {
      add(c.slug);
      for (const l of wikilinks(c.body)) if (l.startsWith("rules/")) add(l);
    }
  }
  // Past learnings about this component or issue, newest first (read from page bodies, no wait for gbrain's link sweep).
  const learned = await learningsFor(comp, target ? issueSlug(target.issue) : undefined);
  for (const l of learned) add(l);
  if (target) {
    add(issueSlug(target.issue));
    for (const c of target.customers) {
      add(`companies/${c}`);
      const contact = world.customers.find((x) => x.id === c)?.contactSlug;
      if (contact) add(contact);
    }
  }
  if (query) for (const r of await search(query)) add(r.slug);
  // Past learnings go first and short, so callers that truncate the context (the Forge keeps 1500 chars) still see them.
  const parts: string[] = [];
  if (learned.length) parts.push(`${learned.length} past learning(s) from other agents; apply them.`);
  const ordered = [...slugs.filter((s) => s.startsWith("learnings/")), ...slugs.filter((s) => !s.startsWith("learnings/"))];
  for (const s of ordered) {
    const p = await load(s);
    if (!p) continue;
    const isLearning = s.startsWith("learnings/");
    const text = isLearning ? p.body.trim().replace(/\n\nAbout \[\[[\s\S]*$/, "").slice(0, 600) : p.body.trim().slice(0, 1500);
    parts.push(`# ${isLearning ? "Past learning: " : ""}${p.title} (${s})\n${text}`);
  }
  return { slugs, context: parts.join("\n\n") };
}

async function ensureUnitPage(unitId: string) {
  const slug = `units/${unitId}`;
  if (await getPage(slug)) return slug;
  // Links come from wikilinks (gbrain serve sweeps them); add_link is refused on a managed brain.
  const content = `---\ntype: unit\ntitle: Unit ${unitId}\n---\nAgent unit ${unitId} in the QM Raid game. Works issues in [[lumen]].\n`;
  try {
    await tool("put_page", { slug, content });
  } catch {
    // Soft-deleted by a reset: bring it back.
    await tool("restore_page", { slug }).catch(() => {});
    await tool("put_page", { slug, content, force: true });
  }
  return slug;
}

const LEARNING_SLUG = /^learnings\/[a-z0-9][a-z0-9._-]{0,120}$/;

async function remember(unitId: string, targetId: string | undefined, text: string, wantSlug?: string) {
  const target = await resolveTarget(targetId);
  const issue = target?.issue ?? "general";
  const ts = Date.now();
  // The engine may assign the slug (learnings/<issue>-<unitId>-<ms>) so its memory.remember event matches the page.
  const given = wantSlug?.trim().toLowerCase();
  const slug = given && LEARNING_SLUG.test(given) ? given : `learnings/${issue.toLowerCase()}-${unitId}-${ts}`;
  const unitSlug = await ensureUnitPage(unitId);
  const about = target ? `About [[${issueSlug(target.issue)}]] in [[components/${target.component}]]. ` : "";
  const title = `Learning${target ? ` on ${target.issue}` : ""} by ${unitId}`;
  const content = `---\ntype: learning\ntitle: "${title}"\n---\n${text.trim().slice(0, 2000)}\n\n${about}Learned by [[${unitSlug}]] at ${new Date(ts).toISOString()}.\n`;
  // A repeated remember on the same slug overwrites that learning.
  await tool("put_page", { slug, content }).catch(() => tool("put_page", { slug, content, force: true }));
  invalidateGraph();
  return { slug };
}

async function search(q: string) {
  const rows = await tool<any[]>("search", { query: q, limit: 10 });
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => !HIDDEN.has(r.slug))
    .map((r) => ({ slug: r.slug, title: r.title, snippet: String(r.chunk_text ?? "").replace(/\s+/g, " ").slice(0, 200) }));
}

// add_link is refused on a managed brain, so a link is a wikilink appended to the from page (swept into a link by gbrain).
async function addLink(from: string, to: string, linkType?: string) {
  const p = await getPage(from);
  if (!p) throw new Error(`no page ${from}`);
  if (!(await getPage(to))) throw new Error(`no page ${to}`);
  const line = `Related${linkType ? ` (${linkType.replace(/[^a-z_ ]/gi, "")})` : ""}: [[${to}]]`;
  const content = `---\ntype: ${p.type || "concept"}\ntitle: "${p.title.replace(/"/g, "'")}"\n---\n${p.body.trim()}\n\n${line}\n`;
  await tool("put_page", { slug: from, content, force: true });
  invalidateGraph();
  return { ok: true, from, to };
}

type PoolIssue = { title: string; component: string; kind: string; severity: number; customers: string[]; text: string; repro?: string; where?: string; done?: string };
const POOL_FILE = join(WORLD_DIR, "issue-pool.json");

// POST /issues: a new issue page, from the given fields or the next unused pool issue (pool refills on /reset).
async function createIssue(b: any) {
  const world = loadWorld();
  const x = Number(b.pos?.x), y = Number(b.pos?.y);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 23 || y > 23) throw new HttpError(400, "pos {x, y} with integer tiles 0..23 required");
  const existing = await listAll({ type: "issue" });
  let spec: PoolIssue;
  if (!b.title) {
    const pool: PoolIssue[] = JSON.parse(readFileSync(POOL_FILE, "utf8"));
    const used = new Set(existing.map((r) => dropPrefix(r.title)));
    const next = pool.find((p) => !used.has(p.title));
    if (!next) throw new HttpError(409, "issue pool exhausted; POST /reset refills it");
    spec = { ...next, component: b.component ?? next.component };
  } else {
    let component = b.component;
    if (!component) {
      // Least busy component: fewest open issue pages.
      const count = new Map(world.components.map((c) => [c.id, 0]));
      for (const r of existing) {
        const t = await resolveTarget(r.slug.slice("issues/".length));
        if (t && count.has(t.component)) count.set(t.component, count.get(t.component)! + 1);
      }
      component = [...count.entries()].sort((a, c) => a[1] - c[1])[0][0];
    }
    spec = { title: String(b.title).slice(0, 140), component, kind: b.kind ?? "bug", severity: b.severity ?? 2, customers: b.customers ?? [], text: String(b.body ?? "").slice(0, 2000) };
  }
  if (!world.components.some((c) => c.id === spec.component)) throw new HttpError(400, `unknown component ${spec.component}`);
  const kind = spec.kind === "feature" ? "feature" : "bug";
  const severity = [1, 2, 3].includes(Number(spec.severity)) ? Number(spec.severity) : 2;
  const customers = (Array.isArray(spec.customers) ? spec.customers : []).map(String).filter((c) => world.customers.some((x) => x.id === c));
  // The brain is the only allocator: next unused LUM number (under the write lock), target id t<number>.
  const nums = [...existing.map((r) => r.slug), ...world.targets.map((t) => issueSlug(t.issue))]
    .map((sl) => Number(/^issues\/lum-(\d+)$/.exec(sl)?.[1]) || 0);
  const num = Math.max(100, ...nums) + 1;
  const issue = `LUM-${num}`;
  const slug = issueSlug(issue);
  const reporters = customers.map((c) => {
    const contact = world.customers.find((x) => x.id === c)?.contactSlug;
    return contact ? `[[companies/${c}]] via [[${contact}]]` : `[[companies/${c}]]`;
  });
  const title = spec.title.replace(/"/g, "'");
  const sections = [
    `${issue} (${kind}, severity ${severity}) in [[components/${spec.component}]]: ${title}.`,
    `Reported by: ${reporters.length ? reporters.join(", ") : "internal QA"}`,
    spec.text,
    spec.repro ? `## Repro\n${spec.repro}` : "",
    spec.where ? `## Where to look\n${spec.where}` : "",
    spec.done ? `## Done when\n${spec.done}` : "",
  ].filter(Boolean);
  const content = `---\ntype: issue\ntitle: "${issue}: ${title}"\nissue: ${issue}\ncomponent: ${spec.component}\nkind: ${kind}\nseverity: ${severity}\nstatus: open\nspawned: true\npos_x: ${x}\npos_y: ${y}\n---\n${sections.join("\n\n")}\n`;
  try {
    await tool("put_page", { slug, content });
  } catch {
    // Soft-deleted by a reset: bring the slug back.
    await tool("restore_page", { slug }).catch(() => {});
    await tool("put_page", { slug, content, force: true });
  }
  invalidateGraph();
  const target: Target = { id: `t${num}`, issue, title, component: spec.component, kind, severity: severity as Target["severity"], status: "open", pos: { x, y }, customers };
  return { ok: true, target };
}

function worldFiles(dir = BRAIN_DIR, prefix = ""): { slug: string; content: string }[] {
  const out: { slug: string; content: string }[] = [];
  for (const f of readdirSync(dir).sort()) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) out.push(...worldFiles(full, `${prefix}${f}/`));
    else if (f.endsWith(".md")) out.push({ slug: `${prefix}${f.slice(0, -3)}`, content: readFileSync(full, "utf8") });
  }
  return out;
}

// Demo reset: soft-delete game-made pages (learnings, units) and rewrite the world pages from world/brain.
async function reset() {
  let deleted = 0;
  for (const type of ["learning", "unit"]) {
    const rows = await listAll({ type });
    for (const r of rows) {
      await tool("delete_page", { slug: r.slug, force: true }).then(() => deleted++).catch((e) => console.error("[brain] reset delete", r.slug, e.message));
    }
  }
  // Spawned issues (issue pages not in world/brain) go too, which refills the issue pool.
  const worldSlugs = new Set(worldFiles().map((f) => f.slug));
  for (const r of await listAll({ type: "issue" })) {
    if (worldSlugs.has(r.slug)) continue;
    await tool("delete_page", { slug: r.slug, force: true }).then(() => deleted++).catch((e) => console.error("[brain] reset delete", r.slug, e.message));
  }
  let restored = 0;
  for (const f of worldFiles()) {
    await tool("put_page", { slug: f.slug, content: f.content, force: true }).then(() => restored++).catch((e) => console.error("[brain] reset put", f.slug, e.message));
  }
  invalidateGraph();
  return { ok: true, deleted, restored };
}

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === "GET" && p === "/health") return json({ ok: true, service: "brain", gbrainPid: childPid() });
  if (req.method === "GET" && p === "/world") {
    const world = loadWorld();
    return json({ ...world, targets: [...world.targets, ...(await spawnedTargets())] });
  }
  if (req.method === "GET" && p === "/stats") {
    const pages = await listPages();
    return json({ pages: pages.length });
  }
  if (req.method === "GET" && p === "/graph") return json(await graph());
  if (req.method === "GET" && p === "/search") return json(await search(url.searchParams.get("q") ?? ""));
  if (req.method === "GET" && p === "/page") {
    const slug = url.searchParams.get("slug");
    if (!slug) return fail("slug required");
    const page = await getPage(slug);
    return page ? json({ slug: page.slug, title: page.title, body: page.body }) : fail("not found", 404);
  }
  if (req.method === "POST" && p === "/recall") {
    const b = await body(req);
    return json(await recall(b.componentId, b.targetId));
  }
  if (req.method === "POST" && p === "/remember") {
    const b = await body(req);
    if (!b.unitId || !b.text) return fail("unitId and text required");
    return json(await exclusive(() => remember(String(b.unitId), b.targetId, String(b.text), b.slug)));
  }
  if (req.method === "POST" && p === "/reset") return json(await exclusive(reset));
  if (req.method === "POST" && p === "/issues") {
    const b = await body(req);
    return json(await exclusive(() => createIssue(b)));
  }
  if (req.method === "POST" && p === "/forget") {
    // Test cleanup (not in the contract): soft-delete one game-made page.
    const slug = String((await body(req)).slug ?? "");
    const spawnedIssue = slug.startsWith("issues/") && !worldFiles().some((f) => f.slug === slug);
    if (!/^(learnings\/|units\/)/.test(slug) && !spawnedIssue) return fail("only learnings/*, units/* and spawned issues can be forgotten");
    await exclusive(() => tool("delete_page", { slug, force: true }));
    invalidateGraph();
    return json({ ok: true, slug });
  }
  return fail("not found", 404);
}

Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req) {
    try {
      return await route(req);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.message, e.status);
      console.error("[brain]", (e as Error).message);
      return fail((e as Error).message, 500);
    }
  },
});
console.log(`[brain] listening on http://${HOST}:${PORT}`);
startMcp({
  search, getPage, recall,
  remember: (unitId, targetId, text, slug) => exclusive(() => remember(unitId, targetId, text, slug)),
  addLink: (from, to, linkType) => exclusive(() => addLink(from, to, linkType)),
}, MCP_PORT);
