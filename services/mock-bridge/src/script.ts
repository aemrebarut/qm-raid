// Builds the fake work sequence a mock agent plays back after a send.
// Pure functions: no timers, no I/O. index.ts schedules the steps.
import type { BridgeEvent, SendRequest } from "../../../contract/types.ts";

export type Step = { at: number; event: BridgeEvent }; // at = ms after the send

export interface OrderInfo {
  issue: string | null;      // "LUM-12"
  component: string | null;  // "billing"
  title: string | null;
  customers: string[];       // slugs, ["companies/acme-robotics"]
  isOrder: boolean;
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
  const isOrder = !!issue || /\b(issue|order|fix|bug|feature|target)\b/i.test(text) || text.length > 120;
  return { issue, component, title: title && title.length > 0 ? title.slice(0, 120) : null, customers, isOrder };
}

const FLAVOR: Record<string, { file: string; rule: string; fix: string; test: string }> = {
  billing: { file: "src/billing/charge.ts", rule: "every charge retry must reuse the original idempotency key", fix: "passed the idempotency key through the retry path", test: "billing/retry.test.ts" },
  auth: { file: "src/auth/session.ts", rule: "session tokens are rotated on privilege change, never extended", fix: "rotated the token instead of extending its expiry", test: "auth/session.test.ts" },
  onboarding: { file: "src/onboarding/wizard.ts", rule: "wizard steps must be resumable from the saved draft", fix: "persisted the draft before advancing a step", test: "onboarding/wizard.test.ts" },
  search: { file: "src/search/index.ts", rule: "reindex jobs must be tenant scoped", fix: "scoped the reindex query to the tenant id", test: "search/index.test.ts" },
};

function flavorFor(component: string | null) {
  if (component && FLAVOR[component]) return FLAVOR[component];
  const c = component ?? "core";
  return { file: `src/${c}/index.ts`, rule: `${c} changes need a regression test first`, fix: `guarded the ${c} edge case`, test: `${c}/index.test.ts` };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export interface ScriptOpts { rand?: () => number; errorRate?: number; now?: number }

// An order (has orderId, or looks like one) plays the full 6 to 10 s work sequence; a direct message gets a short chat.
export function isOrderSend(req: SendRequest): boolean {
  return !!req.orderId || parseOrder(req.text, req.componentId).isOrder;
}

export function buildScript(unitId: string, unitName: string, req: SendRequest, opts: ScriptOpts = {}): Step[] {
  const rand = opts.rand ?? Math.random;
  if (!isOrderSend(req)) return chatScript(unitId, unitName, req.text, rand);
  const o = parseOrder(req.text, req.componentId);
  const failed = rand() < (opts.errorRate ?? 0);
  return orderScript(unitId, unitName, o, req.orderId, failed, opts.now ?? Date.now(), rand);
}

function orderScript(unitId: string, unitName: string, o: OrderInfo, orderId: string | undefined, failed: boolean, now: number, rand: () => number): Step[] {
  const comp = o.component ?? "core";
  const f = flavorFor(o.component);
  const issue = o.issue ?? "the issue";
  const title = o.title ?? `work on ${comp}`;
  const issueSlug = o.issue ? `issues/${o.issue.toLowerCase()}` : null;
  const recallSlugs = [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), ...o.customers];
  // contract slug convention: learnings/<issue>-<unitId>-<epoch ms>
  const learnSlug = `learnings/${slugify(o.issue ?? comp)}-${slugify(unitId)}-${now}`;
  const oid = orderId ? { orderId } : {};
  const a = (kind: "message" | "tool" | "thinking" | "error", text: string, tool?: string, args?: unknown): BridgeEvent =>
    tool ? { type: "activity", unitId, ...oid, kind, text, tool, args } : { type: "activity", unitId, ...oid, kind, text };

  // Relative positions 0..1 of each step; scaled to a total of 6 to 10 seconds.
  const seq: Array<[number, BridgeEvent]> = [
    [0.03, a("thinking", `Reading the order: ${issue} "${title}" in ${comp}.`)],
    [0.12, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall",
      { query: `${comp} ${title}`, slugs: recallSlugs })],
    [0.22, a("message", `GBrain house rule for ${comp}: ${f.rule}.`)],
    [0.32, a("tool", `Reading ${f.file}`, "read_file", { path: f.file })],
    [0.42, a("message", `Reproduced ${issue} locally.`)],
    [0.52, a("thinking", `The bug matches the house rule; the code breaks it.`)],
    [0.62, a("tool", `Editing ${f.file}`, "edit_file", { path: f.file })],
    [0.72, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
    [0.80, a("message", `Tests pass. I ${f.fix}.`)],
    [0.88, a("tool", `Remembering the learning from ${issue}`, "gbrain.remember",
      { slug: learnSlug, text: `${title}: ${f.fix}. Rule: ${f.rule}.`, links: [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), `units/${unitId}`] })],
  ];
  if (issueSlug && rand() < 0.5) seq.push([0.93, a("tool", `Linking the learning to ${issue}`, "gbrain.add_link", { from: learnSlug, to: issueSlug, linkType: "mentions" })]);
  if (failed) {
    // MOCK_FAIL path: tests fail, no remember, terminal error event instead of a reply
    seq.splice(8); // keep up to the test run
    seq.push([0.85, a("error", `${f.test} still fails after the edit.`)]);
    seq.push([1.0, { type: "error", unitId, ...oid, text: `${unitName}: could not fix ${issue}; ${f.test} still fails.` }]);
  } else {
    seq.push([1.0, { type: "reply", unitId, ...oid, text: `${unitName}: fixed ${issue} "${title}". I ${f.fix}, added a regression test in ${f.test}, and saved the learning to GBrain as ${learnSlug}.` }]);
  }

  const total = 6000 + Math.floor(rand() * 4000);
  const tokens = 2000 + Math.floor(rand() * 6000);
  seq.splice(seq.length - 1, 0, [0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * total), event }));
}

function chatScript(unitId: string, unitName: string, text: string, rand: () => number): Step[] {
  const total = 2000 + Math.floor(rand() * 1500);
  const tokens = 300 + Math.floor(rand() * 700);
  return [
    { at: 150, event: { type: "activity", unitId, kind: "thinking", text: `Considering: "${text.slice(0, 80)}"` } },
    { at: Math.round(total * 0.5), event: { type: "activity", unitId, kind: "tool", text: "Searching GBrain for context", tool: "gbrain.search", args: { query: text.slice(0, 80), slugs: [] } } },
    { at: total - 50, event: { type: "usage", unitId, tokens, usd: usd(tokens) } },
    { at: total, event: { type: "reply", unitId, text: `${unitName}: understood, "${text.slice(0, 80)}". Ready for the next order.` } },
  ];
}

const usd = (tokens: number) => Math.round(tokens * 0.000015 * 10000) / 10000;
