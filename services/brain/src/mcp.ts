// Minimal stateless MCP facade for QM agents (POST /mcp, JSON-RPC, auth none) on 127.0.0.1:4617.
// Every tool goes through the brain service's ops, so the service stays the only owner of the game brain.

export interface BrainOps {
  search(q: string): Promise<unknown>;
  getPage(slug: string): Promise<unknown>;
  recall(componentId?: string, targetId?: string, query?: string): Promise<unknown>;
  remember(unitId: string, targetId: string | undefined, text: string, slug?: string): Promise<unknown>;
  addLink(from: string, to: string, linkType?: string): Promise<unknown>;
}

const str = (description: string) => ({ type: "string", description });

const TOOLS = [
  {
    name: "recall",
    description: "Recall what the team knows before working an issue: the component's house rules and gotchas, the issue, the customers who reported it, and past learnings from other agents. Call this first. Pass the unitId, targetId and componentId from your order header.",
    inputSchema: { type: "object", properties: { componentId: str("component id, e.g. billing"), targetId: str("target id, e.g. t101"), query: str("optional free-text search to add"), unitId: str("your unit id") } },
  },
  {
    name: "remember",
    description: "Save a learning to the shared brain after working an issue: a non-obvious rule, root cause or gotcha that the next agent should know. One or two sentences. Creates a learning page linked to the issue, component and your unit.",
    inputSchema: { type: "object", properties: { targetId: str("target id, e.g. t101"), text: str("the learning"), unitId: str("your unit id"), slug: str("learning slug from your order header, e.g. learnings/lum-101-u1-1790546000000") }, required: ["text"] },
  },
  {
    name: "search",
    description: "Keyword search over the shared brain (components, issues, customers, rules, learnings).",
    inputSchema: { type: "object", properties: { query: str("search terms") }, required: ["query"] },
  },
  {
    name: "get_page",
    description: "Read one brain page by slug, e.g. components/billing, issues/lum-101, companies/acme-robotics.",
    inputSchema: { type: "object", properties: { slug: str("page slug") }, required: ["slug"] },
  },
  {
    name: "add_link",
    description: "Link two brain pages (adds a wikilink from one page to the other).",
    inputSchema: { type: "object", properties: { from: str("from slug"), to: str("to slug"), linkType: str("optional link type") }, required: ["from", "to"] },
  },
];

async function callTool(ops: BrainOps, name: string, a: any): Promise<unknown> {
  switch (name) {
    case "recall": return ops.recall(a.componentId, a.targetId, a.query);
    case "remember":
      if (!a.text) throw new Error("text required");
      return ops.remember(String(a.unitId ?? "agent"), a.targetId, String(a.text), a.slug ? String(a.slug) : undefined);
    case "search": return ops.search(String(a.query ?? ""));
    case "get_page": {
      const p = await ops.getPage(String(a.slug ?? ""));
      if (!p) throw new Error(`no page ${a.slug}`);
      return p;
    }
    case "add_link": return ops.addLink(String(a.from), String(a.to), a.linkType);
    default: throw new Error(`unknown tool ${name}`);
  }
}

async function handle(ops: BrainOps, msg: any): Promise<object | null> {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return null; // notification
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (method === "initialize") {
    return ok({ protocolVersion: params?.protocolVersion ?? "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "qm-raid-gbrain", version: "0.1" } });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await callTool(ops, params?.name, params?.arguments ?? {});
      return ok({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } catch (e) {
      return ok({ content: [{ type: "text", text: `error: ${(e as Error).message}` }], isError: true });
    }
  }
  return err(-32601, `method not found: ${method}`);
}

export function startMcp(ops: BrainOps, port: number) {
  Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") return Response.json({ ok: true, service: "brain-mcp" });
      if (url.pathname !== "/mcp") return Response.json({ ok: false, error: "not found" }, { status: 404 });
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let msg: any;
      try { msg = await req.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 }); }
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map((m) => handle(ops, m)))).filter(Boolean);
        return out.length ? Response.json(out) : new Response(null, { status: 202 });
      }
      const out = await handle(ops, msg);
      return out ? Response.json(out) : new Response(null, { status: 202 });
    },
  });
  console.log(`[brain] MCP facade on http://127.0.0.1:${port}/mcp`);
}
