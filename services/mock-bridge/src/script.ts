// Builds the fake work sequence a mock agent plays back after a send.
// Pure functions: no timers, no I/O. index.ts schedules the steps.
import type { BridgeEvent, SendRequest } from "../../../contract/types.ts";

export type Step = { at: number; event: BridgeEvent }; // at = ms after the send

export interface OrderInfo {
  issue: string | null;      // "LUM-12"
  component: string | null;  // "billing"
  title: string | null;
  customers: string[];       // slugs, ["companies/acme-robotics"]
  learningSlug: string | null; // engine-assigned "learnings/lum-12-u1-1790546460000"
}

const COMPONENTS = ["billing", "auth", "onboarding", "search"];

// Loose parse of whatever order text the engine sends (the M2 prompt format may change).
export function parseOrder(text: string, componentId?: string): OrderInfo {
  const num = text.match(/issue\s*#?\s*(\d+)/i) ?? text.match(/#(\d+)\b/);
  const issue = text.match(/\b([A-Z]{2,6}-\d+)\b/)?.[1] ?? (num ? `LUM-${num[1]}` : null);
  let component = componentId?.toLowerCase() ?? text.match(/\bcomponent\b\s*[:=]\s*(?:components\/)?([a-z0-9_-]+)/i)?.[1]?.toLowerCase() ?? null;
  if (!component) component = COMPONENTS.find((c) => new RegExp(`\\b${c}\\b`, "i").test(text)) ?? null;
  const title = text.match(/title\s*[:=]\s*"?([^"\n]+)"?/i)?.[1]?.trim()
    ?? (issue ? text.match(new RegExp(`${issue}\\s*[:\\-]?\\s*"?([^"\\n]+)"?`))?.[1]?.trim() ?? null : null);
  const ids = text.match(/^\s*customers\s*:\s*(.+)$/im)?.[1]?.split(/[,\s]+/).filter((c) => /^[a-z0-9-]+$/.test(c)) ?? [];
  const slugs = (text.match(/(?:customers|companies)\/[a-z0-9-]+/g) ?? []).map((c) => c.replace(/^customers\//, "companies/"));
  const customers = [...new Set([...ids.map((c) => `companies/${c}`), ...slugs])];
  const learningSlug = text.match(/\blearnings\/[a-z0-9][a-z0-9-]*/)?.[0] ?? null;
  return { issue, component, title: title && title.length > 0 ? title.slice(0, 120) : null, customers, learningSlug };
}

// House rules mirror world/brain (rules/* pages exist for billing, auth, search) so recall beams hit real pages.
type Flavor = { file: string; rule: string; ruleSlug: string | null; fix: string; test: string };
const FLAVOR: Record<string, Flavor> = {
  billing: { file: "src/billing/charge.ts", rule: "retries must reuse the idempotency key inv_<invoiceId>, never add the attempt number", ruleSlug: "rules/billing-idempotency", fix: "made the retry reuse inv_<invoiceId> as the idempotency key", test: "billing/retry.test.ts" },
  auth: { file: "src/auth/token.ts", rule: "compare token expiry with a 120 second clock skew allowance", ruleSlug: "rules/auth-clock-skew", fix: "added the 120 second skew allowance to the expiry check", test: "auth/token.test.ts" },
  onboarding: { file: "src/onboarding/invites.ts", rule: "all outbound email goes through the mailer queue, never inline", ruleSlug: null, fix: "moved the invite email onto the mailer queue", test: "onboarding/invites.test.ts" },
  search: { file: "src/search/query.ts", rule: "scope every query by workspace_id in the index query, never post-filter", ruleSlug: "rules/search-tenant-scope", fix: "scoped the index query by workspace_id on the cached path too", test: "search/query.test.ts" },
};

function flavorFor(component: string | null): Flavor {
  if (component && FLAVOR[component]) return FLAVOR[component];
  const c = component ?? "core";
  return { file: `src/${c}/index.ts`, rule: `${c} changes need a regression test first`, ruleSlug: null, fix: `guarded the ${c} edge case`, test: `${c}/index.test.ts` };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export interface ScriptOpts {
  rand?: () => number;
  errorRate?: number;  // MOCK_FAIL: share of orders that end in a terminal error event
  noGbrain?: boolean;  // MOCK_NO_GBRAIN: no gbrain tool calls at all (exercises the engine fallback)
  mcpRate?: number;    // share of runs that use MCP-style tool names (mcp__gbrain__search, ...)
  now?: number;
}

// Only an explicit orderId makes a send an order (full 6 to 10 s work sequence); anything else is a direct
// message and gets a short chat, even if its text mentions an issue. Text parsing only supplies context.
export function isOrderSend(req: SendRequest): boolean {
  return typeof req.orderId === "string" && req.orderId.length > 0;
}

// gbrain tool names as a real QM agent may report them through MCP
const MCP_NAMES: Record<string, string> = {
  "gbrain.recall": "mcp__gbrain__search", "gbrain.search": "mcp__gbrain__search", "gbrain.get_page": "mcp__gbrain__get_page",
  "gbrain.remember": "mcp__gbrain__put_page", "gbrain.add_link": "mcp__gbrain__add_link",
};

export function buildScript(unitId: string, unitName: string, req: SendRequest, opts: ScriptOpts = {}): Step[] {
  const rand = opts.rand ?? Math.random;
  const o = parseOrder(req.text, req.componentId);
  const steps = isOrderSend(req)
    ? orderScript(unitId, unitName, o, req.orderId, rand() < (opts.errorRate ?? 0), opts.now ?? Date.now(), rand)
    : chatScript(unitId, unitName, req.text, o, rand);
  const gb = (e: BridgeEvent) => e.type === "activity" && !!e.tool?.startsWith("gbrain.");
  if (opts.noGbrain) return steps.filter((s) => !gb(s.event));
  if (rand() < (opts.mcpRate ?? 0)) {
    for (const s of steps) if (gb(s.event) && s.event.type === "activity") s.event = { ...s.event, tool: MCP_NAMES[s.event.tool!] ?? s.event.tool!.replace("gbrain.", "mcp__gbrain__") };
  }
  return steps;
}

function orderScript(unitId: string, unitName: string, o: OrderInfo, orderId: string | undefined, failed: boolean, now: number, rand: () => number): Step[] {
  const comp = o.component ?? "core";
  const f = flavorFor(o.component);
  const issue = o.issue ?? "the issue";
  const title = o.title ?? `work on ${comp}`;
  const issueSlug = o.issue ? `issues/${o.issue.toLowerCase()}` : null;
  const recallSlugs = [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : []), ...(issueSlug ? [issueSlug] : []), ...o.customers];
  // the engine assigns the learning slug in the prompt; else the contract convention learnings/<issue>-<unitId>-<epoch ms>
  const learnSlug = o.learningSlug ?? `learnings/${slugify(o.issue ?? comp)}-${slugify(unitId)}-${now}`;
  const oid = orderId ? { orderId } : {};
  const a = (kind: "message" | "tool" | "thinking" | "error", text: string, tool?: string, args?: unknown): BridgeEvent =>
    tool ? { type: "activity", unitId, ...oid, kind, text, tool, args } : { type: "activity", unitId, ...oid, kind, text };

  // Relative positions 0..1 of each step; scaled to a total of 6 to 10 seconds.
  const seq: Array<[number, BridgeEvent]> = [
    [0.03, a("thinking", `Reading the order: ${issue} "${title}" in ${comp}.`)],
    [0.12, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall",
      { query: `${comp} ${title}`, slugs: recallSlugs })],
    ...(f.ruleSlug ? [[0.18, a("tool", `Reading ${f.ruleSlug}`, "gbrain.get_page", { slug: f.ruleSlug })] as [number, BridgeEvent]] : []),
    [0.24, a("message", `House rule for ${comp}: ${f.rule}.`)],
    [0.32, a("tool", `Reading ${f.file}`, "read_file", { path: f.file })],
    [0.42, a("message", `Reproduced ${issue} locally.`)],
    [0.52, a("thinking", `The bug matches the house rule; the code breaks it.`)],
    [0.62, a("tool", `Editing ${f.file}`, "edit_file", { path: f.file })],
    [0.72, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
  ];
  if (failed) {
    // MOCK_FAIL path: tests fail, no remember, terminal error event instead of a reply
    seq.push([0.85, a("error", `${f.test} still fails after the edit.`)]);
    seq.push([1.0, { type: "error", unitId, ...oid, text: `${unitName}: could not fix ${issue}; ${f.test} still fails.` }]);
  } else {
    seq.push([0.80, a("message", `Tests pass. I ${f.fix}.`)]);
    seq.push([0.88, a("tool", `Remembering the learning from ${issue}`, "gbrain.remember",
      { slug: learnSlug, text: `${title}: ${f.fix}. Rule: ${f.rule}.`, links: [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), `units/${unitId}`] })]);
    if (issueSlug && rand() < 0.5) seq.push([0.93, a("tool", `Linking the learning to ${issue}`, "gbrain.add_link", { from: learnSlug, to: issueSlug, linkType: "mentions" })]);
    seq.push([1.0, { type: "reply", unitId, ...oid, text: `${unitName}: fixed ${issue} "${title}". I ${f.fix}, added a regression test in ${f.test}, and saved the learning to GBrain as ${learnSlug}.` }]);
  }

  const total = 6000 + Math.floor(rand() * 4000);
  const tokens = 2000 + Math.floor(rand() * 6000);
  seq.splice(seq.length - 1, 0, [0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * total), event }));
}

function chatScript(unitId: string, unitName: string, text: string, o: OrderInfo, rand: () => number): Step[] {
  const total = 2000 + Math.floor(rand() * 1000);
  const tokens = 300 + Math.floor(rand() * 700);
  const slugs = [...(o.component ? [`components/${o.component}`] : []), ...(o.issue ? [`issues/${o.issue.toLowerCase()}`] : [])];
  const about = o.issue ? ` about ${o.issue}` : o.component ? ` about ${o.component}` : "";
  return [
    { at: 150, event: { type: "activity", unitId, kind: "thinking", text: `Considering: "${text.slice(0, 80)}"` } },
    { at: Math.round(total * 0.5), event: { type: "activity", unitId, kind: "tool", text: `Searching GBrain${about}`, tool: "gbrain.search", args: { query: text.slice(0, 80), slugs } } },
    { at: total - 50, event: { type: "usage", unitId, tokens, usd: usd(tokens) } },
    { at: total, event: { type: "reply", unitId, text: `${unitName}: got your message${about}. "${text.slice(0, 80)}" noted; I keep going with my current order, if any.` } },
  ];
}

const usd = (tokens: number) => Math.round(tokens * 0.000015 * 10000) / 10000;
