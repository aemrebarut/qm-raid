// Tool name normalization: QM names MCP tools "<serverId>_<tool>" (for example gbrain_search);
// the contract wants gbrain tools as "gbrain.<op>" (gbrain.search, gbrain.get_page, gbrain.put_page, ...).

const GBRAIN_PREFIX = /^(mcp__gbrain__|gbrain[._-])/i;

/** QM wraps MCP tool arguments as {mcpServer, args: {...}}; the engine reads them flat (slugs, componentId, targetId, query). */
export function toolArgs(args: Record<string, unknown> = {}): Record<string, unknown> {
  const inner = args.args;
  if (typeof args.mcpServer === "string" && inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return args;
}

export function normalizeTool(name: string, args: Record<string, unknown> = {}): string {
  const n = String(name ?? "tool");
  if (GBRAIN_PREFIX.test(n)) return `gbrain.${n.replace(GBRAIN_PREFIX, "")}`;
  // Some QM tool calls carry the MCP server/tool in args instead of the name.
  const server = args.mcpServer ?? args.server ?? args.serverId;
  const tool = args.tool ?? args.toolName ?? args.name;
  if (typeof server === "string" && /^gbrain$/i.test(server) && typeof tool === "string") {
    return `gbrain.${tool.replace(GBRAIN_PREFIX, "")}`;
  }
  // Built-in QM tools: keep the name, add the action when present (skills.read, memory.rewrite).
  if (typeof args.action === "string" && !n.includes(".")) return `${n}.${args.action}`;
  return n;
}

export function toolText(tool: string, args: Record<string, unknown> = {}): string {
  const hint =
    (typeof args.query === "string" && args.query) ||
    (typeof args.componentId === "string" && `component ${args.componentId}`) ||
    (typeof args.slug === "string" && args.slug) ||
    (typeof args.name === "string" && args.name) ||
    (typeof args.command === "string" && args.command) ||
    "";
  return hint ? `${tool}: ${String(hint).slice(0, 160)}` : tool;
}
