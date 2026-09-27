// Brain service: the game world and GBrain game memory over HTTP (docs/CONTRACT.md, Brain API).
import { tool, childPid } from "./gbrain.ts";
import { loadWorld, issueSlug, BRAIN_DIR } from "./world.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { startMcp } from "./mcp.ts";

const PORT = Number(process.env.BRAIN_PORT ?? 4616);
const MCP_PORT = Number(process.env.BRAIN_MCP_PORT ?? 4617);
const HOST = "127.0.0.1";
// Leftovers from the pre-hackathon smoke test; not part of the Lumen world.
const HIDDEN = new Set(["people/sam-ortiz", "meetings/2026-09-20-acme-kickoff"]);

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: string, status = 400) => json({ ok: false, error }, status);

type Link = { from_slug: string; to_slug: string; link_type: string };
type PageRow = { slug: string; type: string; title: string };

async function getPage(slug: string): Promise<{ slug: string; title: string; type: string; body: string } | null> {
  try {
    const p = await tool<any>("get_page", { slug });
    if (!p || typeof p !== "object" || !p.slug) return null;
    return { slug: p.slug, title: p.title ?? slug, type: p.type ?? "", body: p.compiled_truth ?? "" };
  } catch {
    return null;
  }
}

async function listPages(): Promise<PageRow[]> {
  const rows = await tool<PageRow[]>("list_pages", { limit: 1000 });
  return rows.filter((r) => !HIDDEN.has(r.slug));
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
const slugMs = (s: string) => Number(s.split("-").pop()) || 0;

// Newest learnings whose body links the component or the issue.
async function learningsFor(comp: string | undefined, issue: string | undefined): Promise<string[]> {
  const rows = await tool<PageRow[]>("list_pages", { type: "learning", limit: 1000 }).catch(() => [] as PageRow[]);
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

let graphCache: { nodes: any[]; edges: any[] } | null = null;
let graphAt = 0;
const GRAPH_TTL_MS = 10000;

async function graph() {
  if (graphCache && Date.now() - graphAt < GRAPH_TTL_MS) return graphCache;
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
  graphCache = { nodes: pages.map((p) => ({ id: p.slug, type: nodeType(p), title: p.title })), edges };
  graphAt = Date.now();
  return graphCache;
}

async function recall(componentId?: string, targetId?: string, query?: string) {
  const world = loadWorld();
  const target = world.targets.find((t) => t.id === targetId);
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
  const world = loadWorld();
  const target = world.targets.find((t) => t.id === targetId);
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
  graphCache = null;
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
  graphCache = null;
  return { ok: true, from, to };
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
    const rows = await tool<PageRow[]>("list_pages", { type, limit: 1000 });
    for (const r of rows) {
      await tool("delete_page", { slug: r.slug, force: true }).then(() => deleted++).catch((e) => console.error("[brain] reset delete", r.slug, e.message));
    }
  }
  let restored = 0;
  for (const f of worldFiles()) {
    await tool("put_page", { slug: f.slug, content: f.content, force: true }).then(() => restored++).catch((e) => console.error("[brain] reset put", f.slug, e.message));
  }
  graphCache = null;
  return { ok: true, deleted, restored };
}

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (req.method === "GET" && p === "/health") return json({ ok: true, service: "brain", gbrainPid: childPid() });
  if (req.method === "GET" && p === "/world") return json(loadWorld());
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
  if (req.method === "POST" && p === "/forget") {
    // Test cleanup (not in the contract): soft-delete one game-made page.
    const slug = String((await body(req)).slug ?? "");
    if (!/^(learnings\/|units\/)/.test(slug)) return fail("only learnings/* and units/* can be forgotten");
    await exclusive(() => tool("delete_page", { slug, force: true }));
    graphCache = null;
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
