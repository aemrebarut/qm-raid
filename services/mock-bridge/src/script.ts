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
  role: "planner" | "implementer" | "reviewer" | string; // workflow role; "implementer" for plain orders
  reviewChange: string | null; // latest "VERDICT: CHANGES: <what>" in the previous work (implementer on a changes loop)
  reviews: number;              // verdict lines already in the previous work (earlier reviews of this run)
  previous: Prev[];             // the "Previous work:" entries, latest last
}
export type Prev = { role: string; unitId: string; name: string | null; reply: string };

// Workflow prompts (engine game.ts briefText) are the order prompt, then a line "Role: <role>. <instructions>", then
// "Previous work:" with "- <role> (<unitId>): <reply>" lines, latest last. The role comes only from the Role line before
// "Previous work:": an implementer on a changes loop gets the reviewer's "VERDICT: CHANGES:" reply in that block.
// No Role line = a plain order (implementer).
export function roleOf(text: string): { role: string; reviewChange: string | null; reviews: number; previous: Prev[] } {
  const cut = text.search(/^Previous work:/m);
  const head = cut >= 0 ? text.slice(0, cut) : text;
  const tail = cut >= 0 ? text.slice(cut) : "";
  const role = head.match(/^Role: (\w+)\./m)?.[1]?.toLowerCase() ?? "implementer";
  const changes = [...tail.matchAll(/VERDICT:\s*CHANGES:\s*([^\n]+)/gi)].map((m) => m[1]!.trim()).filter((c) => c && !/^<.*>$/.test(c));
  const reviews = [...tail.matchAll(/VERDICT:\s*(APPROVED|CHANGES)/gi)].length;
  // entries are "- <role> (<unitId>): <reply>"; a reply may run over several lines
  const previous: Prev[] = [];
  for (const part of tail.split(/^- (?=[^\n()]+ \([^\n()]+\): )/m).slice(1)) {
    const m = part.match(/^([^\n()]+) \(([^\n()]+)\): ([\s\S]*)$/);
    if (!m) continue;
    const reply = m[3]!.trim();
    previous.push({ role: m[1]!.trim().toLowerCase(), unitId: m[2]!.trim(), name: reply.match(/^([A-Z][\w .'-]{0,40}?): /)?.[1] ?? null, reply });
  }
  return { role, reviewChange: changes.at(-1) ?? null, reviews, previous };
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
  return { issue, component, title: title && title.length > 0 ? title.slice(0, 120) : null, customers, learningSlug, ...roleOf(text) };
}

// House rules mirror world/brain (rules/* pages exist for billing, auth, search) so recall beams hit real pages.
type Flavor = { file: string; rule: string; ruleSlug: string | null; fix: string; test: string; symptom?: string; change?: string };
const FLAVOR: Record<string, Flavor> = {
  billing: { file: "src/billing/charge.ts", rule: "retries must reuse the idempotency key inv_<invoiceId>, never add the attempt number", ruleSlug: "rules/billing-idempotency", fix: "made the retry reuse inv_<invoiceId> as the idempotency key", test: "billing/retry.test.ts", symptom: "the retry still creates a second charge", change: "add a regression test that retries twice with the same inv_<invoiceId> key and asserts exactly one charge" },
  auth: { file: "src/auth/token.ts", rule: "compare token expiry with a 120 second clock skew allowance", ruleSlug: "rules/auth-clock-skew", fix: "added the 120 second skew allowance to the expiry check", test: "auth/token.test.ts", symptom: "fresh IdP tokens are still rejected as expired", change: "test the skew boundary at 119 and 121 seconds, not only the happy path" },
  onboarding: { file: "src/onboarding/invites.ts", rule: "all outbound email goes through the mailer queue, never inline", ruleSlug: null, fix: "moved the invite email onto the mailer queue", test: "onboarding/invites.test.ts", symptom: "the invite request still times out while sending email", change: "assert the invite is enqueued on the mailer queue and never sent inline" },
  search: { file: "src/search/query.ts", rule: "scope every query by workspace_id in the index query, never post-filter", ruleSlug: "rules/search-tenant-scope", fix: "scoped the index query by workspace_id on the cached path too", test: "search/query.test.ts", symptom: "cached results still show rows from another workspace", change: "apply the workspace_id scope on the cached path too and cover it with a test" },
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
  demo?: boolean;      // MOCK_SCRIPT=demo: first order on a component learns the rule the hard way, later ones recall it
  learnings?: Learning[]; // what earlier mock agents remembered about this order's component (demo mode)
  review?: "loop" | "approve" | "changes"; // reviewer verdict; loop (default): CHANGES on the first review of a run
                                           // (no verdict in the previous work yet), APPROVED after that
  now?: number;
  loadout?: { instructions: string; skills: string[] }; // the unit's loadout: orders open with a note on skills and standing orders
}

export interface Learning { slug: string; component: string; unitId: string; unitName: string; text: string }

// The component a remember event is about (for the demo memory in index.ts).
export function learningFrom(ev: BridgeEvent, unitName: string): Learning | null {
  if (ev.type !== "activity" || !ev.tool || !/remember|put_page/.test(ev.tool)) return null;
  const args = ev.args as { slug?: unknown; text?: unknown; links?: unknown } | undefined;
  const comp = (Array.isArray(args?.links) ? args!.links : []).map(String).find((l) => l.startsWith("components/"))?.slice("components/".length);
  if (typeof args?.slug !== "string" || !comp) return null;
  return { slug: args.slug, component: comp, unitId: ev.unitId, unitName, text: typeof args.text === "string" ? args.text : "" };
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
  const failed = isOrderSend(req) && rand() < (opts.errorRate ?? 0);
  const review = opts.review ?? "loop";
  const verdict = review === "approve" ? "approved" : review === "changes" ? "changes" : o.reviews > 0 ? "approved" : "changes";
  const steps = !isOrderSend(req)
    ? chatScript(unitId, unitName, req.text, o, rand)
    : o.role === "planner" && !failed
      ? planScript(unitId, unitName, o, req.orderId!, rand)
    : o.role === "reviewer" && !failed
      ? reviewScript(unitId, unitName, o, req.orderId!, verdict, rand)
    : o.role === "judge" && !failed
      ? judgeScript(unitId, unitName, o, req.orderId!, review === "changes" ? "changes" : "approved", rand)
    : o.role === "scout" && !failed
      ? scoutScript(unitId, unitName, o, req.orderId!, opts.learnings ?? [], opts.now ?? Date.now(), rand)
    : o.role === "tester" && !failed
      ? testerScript(unitId, unitName, o, req.orderId!, rand)
    : o.role === "herald" && !failed
      ? heraldScript(unitId, unitName, o, req.orderId!, rand)
    : opts.demo && !failed && !opts.noGbrain
      ? demoScript(unitId, unitName, o, req.orderId!, opts.learnings ?? [], opts.now ?? Date.now(), rand)
      : orderScript(unitId, unitName, o, req.orderId, failed, opts.now ?? Date.now(), rand);
  const lo = opts.loadout;
  if (isOrderSend(req) && lo && (lo.skills.length || lo.instructions.trim()) && steps.length) {
    const bits = [...(lo.skills.length ? [`skills ${lo.skills.join(", ")}`] : []), ...(lo.instructions.trim() ? [`standing orders "${lo.instructions.replace(/\s+/g, " ").trim().slice(0, 60)}"`] : [])];
    steps.splice(1, 0, { at: Math.max(1, Math.round(steps[0]!.at / 2 + 150)), event: { type: "activity", unitId, orderId: req.orderId, kind: "thinking", text: `Loadout: ${bits.join("; ")}.` } });
    steps.sort((a, b) => a.at - b.at);
  }
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
    [0.24, a("message", o.reviewChange ? `Applying the review change: ${o.reviewChange}.` : `House rule for ${comp}: ${f.rule}.`)],
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
    const applied = o.reviewChange ? ` Applied the review change: ${o.reviewChange}.` : "";
    seq.push([1.0, { type: "reply", unitId, ...oid, text: `${unitName}: fixed ${issue} "${title}". I ${f.fix}, added a regression test in ${f.test}, and saved the learning to GBrain as ${learnSlug}.${applied}` }]);
  }

  const total = 6000 + Math.floor(rand() * 4000);
  const tokens = 2000 + Math.floor(rand() * 6000);
  seq.splice(seq.length - 1, 0, [0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * total), event }));
}

// Workflow planner: recall, then a 3-step numbered plan; no edits, no remember.
function planScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, rand: () => number): Step[] {
  const comp = o.component ?? "core";
  const f = flavorFor(o.component);
  const issue = o.issue ?? "the issue";
  const issueSlug = o.issue ? `issues/${o.issue.toLowerCase()}` : null;
  const a = (kind: "message" | "tool" | "thinking", text: string, tool?: string, args?: unknown): BridgeEvent =>
    tool ? { type: "activity", unitId, orderId, kind, text, tool, args } : { type: "activity", unitId, orderId, kind, text };
  const plan = [
    `1. Reproduce ${issue} with a failing test in ${f.test}.`,
    `2. In ${f.file}, apply the house rule${f.ruleSlug ? ` (${f.ruleSlug})` : ""}: ${f.rule}.`,
    `3. Run ${f.test}, then remember the learning in GBrain linked to components/${comp}${issueSlug ? ` and ${issueSlug}` : ""}.`,
  ];
  const seq: Array<[number, BridgeEvent]> = [
    [0.05, a("thinking", `Planning ${issue} "${o.title ?? comp}" for the implementer.`)],
    [0.20, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall", { query: `${comp} ${o.title ?? ""}`.trim(), slugs: [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : []), ...(issueSlug ? [issueSlug] : []), ...o.customers] })],
    ...(f.ruleSlug ? [[0.38, a("tool", `Reading ${f.ruleSlug}`, "gbrain.get_page", { slug: f.ruleSlug })] as [number, BridgeEvent]] : []),
    [0.60, a("message", `Plan drafted: 3 steps, built around the ${comp} house rule.`)],
  ];
  const total = 4500 + Math.floor(rand() * 1500);
  const tokens = 1200 + Math.floor(rand() * 2000);
  seq.push([0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  seq.push([1.0, { type: "reply", unitId, orderId, text: `${unitName}: plan for ${issue}:\n${plan.join("\n")}` }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * total), event }));
}

// Workflow reviewer: recall the rules, read, test, and end the reply with the verdict line.
function reviewScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, verdict: "approved" | "changes", rand: () => number): Step[] {
  const comp = o.component ?? "core";
  const f = flavorFor(o.component);
  const issue = o.issue ?? "the issue";
  const change = f.change ?? `add a regression test for the ${comp} edge case in ${f.test}`;
  const a = (kind: "message" | "tool" | "thinking", text: string, tool?: string, args?: unknown): BridgeEvent =>
    tool ? { type: "activity", unitId, orderId, kind, text, tool, args } : { type: "activity", unitId, orderId, kind, text };
  const seq: Array<[number, BridgeEvent]> = [
    [0.05, a("thinking", `Reviewing the ${issue} change against the plan and the ${comp} house rules.`)],
    [0.18, a("tool", `Recalling the ${comp} house rules`, "gbrain.recall", { query: `${comp} house rules`, slugs: [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : [])] })],
    ...(f.ruleSlug ? [[0.30, a("tool", `Reading ${f.ruleSlug}`, "gbrain.get_page", { slug: f.ruleSlug })] as [number, BridgeEvent]] : []),
    [0.45, a("tool", `Reading the diff in ${f.file}`, "read_file", { path: f.file })],
    [0.62, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
    [0.80, a("message", verdict === "changes" ? `Tests pass, but one gap: ${change}.` : `The change follows the rule (${f.rule}) and the tests cover it.`)],
  ];
  const total = 4500 + Math.floor(rand() * 1500);
  const tokens = 1500 + Math.floor(rand() * 2500);
  seq.push([0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  const text = verdict === "changes"
    ? `${unitName}: reviewed ${issue}. The fix applies the ${comp} rule, but it is not proven yet.\nVERDICT: CHANGES: ${change}`
    : `${unitName}: reviewed ${issue} again. The change follows the ${comp} house rule and the tests cover it.\nVERDICT: APPROVED`;
  seq.push([1.0, { type: "reply", unitId, orderId, text }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * total), event }));
}

// Customer-facing wording for the herald (what broke, what we fixed, what the customer needs to do).
const CUSTOMER: Record<string, { broke: string; fixed: string; action: string }> = {
  billing: { broke: "a payment retry could charge the same invoice twice", fixed: "retries now reuse the original payment reference, so a retry can never create a second charge", action: "Nothing. Any duplicate charge is refunded automatically within 5 business days." },
  auth: { broke: "sign-in could reject valid logins when your identity provider's clock ran slightly ahead of ours", fixed: "we now allow a small clock difference, as the token standard recommends", action: "Nothing. Anyone who was locked out can sign in again now." },
  onboarding: { broke: "team invites could time out and never arrive", fixed: "invites are now queued and delivered in the background", action: "Please resend any invite that did not arrive (Settings, Team); it should land within a minute." },
  search: { broke: "search could show cached results from another workspace for a short time", fixed: "every search, cached results included, is now limited to your own workspace", action: "Nothing. We cleared the search cache." },
};
const titleCase = (id: string) => id.replace(/^companies\//, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
type Seq = Array<[number, BridgeEvent]>;
const act = (unitId: string, orderId: string) => (kind: "message" | "tool" | "thinking", text: string, tool?: string, args?: unknown): BridgeEvent =>
  tool ? { type: "activity", unitId, orderId, kind, text, tool, args } : { type: "activity", unitId, orderId, kind, text };
function finish(seq: Seq, unitId: string, orderId: string, text: string, totalMs: number, tokens: number): Step[] {
  seq.push([0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  seq.push([1.0, { type: "reply", unitId, orderId, text }]);
  return seq.map(([p, event]) => ({ at: Math.round(p * totalMs), event }));
}

// Workflow scout (recon): investigate only. Reproduce, point to the code, list the rules and learnings; remembers the recon.
function scoutScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, learnings: Learning[], now: number, rand: () => number): Step[] {
  const comp = o.component ?? "core", f = flavorFor(o.component), issue = o.issue ?? "the issue", a = act(unitId, orderId);
  const issueSlug = o.issue ? `issues/${o.issue.toLowerCase()}` : null;
  const prior = learnings.filter((l) => l.component === comp).at(-1);
  const learnSlug = o.learningSlug ?? `learnings/${slugify(o.issue ?? comp)}-${slugify(unitId)}-${now}`;
  const rules = f.ruleSlug ? `${f.ruleSlug} (${f.rule})` : `the ${comp} house rule (${f.rule})`;
  const seq: Seq = [
    [0.04, a("thinking", `Recon on ${issue} "${o.title ?? comp}": find it, do not fix it.`)],
    [0.14, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall", { query: `${comp} ${o.title ?? ""}`.trim(), slugs: [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : []), ...(issueSlug ? [issueSlug] : []), ...o.customers, ...(prior ? [prior.slug] : [])] })],
    [0.26, a("tool", `Searching GBrain for ${comp} house rules and past learnings`, "gbrain.search", { query: `${comp} house rules learnings`, slugs: [...(f.ruleSlug ? [f.ruleSlug] : []), ...(prior ? [prior.slug] : [])] })],
    [0.40, a("tool", `Reading ${f.file}`, "read_file", { path: f.file })],
    [0.54, a("tool", `Reproducing with ${f.test}`, "run_tests", { path: f.test })],
    [0.64, a("message", `Reproduced: ${f.symptom ?? `the ${comp} edge case fails`}. The cause is in ${f.file}.`)],
    [0.82, a("tool", `Remembering the recon for ${issue}`, "gbrain.remember", { slug: learnSlug, text: `Recon ${issue}: reproduced in ${f.test}; cause in ${f.file}; applies ${f.ruleSlug ?? `the ${comp} rule`}.`, links: [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), ...(f.ruleSlug ? [f.ruleSlug] : []), `units/${unitId}`] })],
  ];
  const text = `${unitName}: recon for ${issue}. Reproduced: ${f.symptom ?? `the ${comp} edge case fails`} (${f.test}). The code is in ${f.file}. Rules that apply: ${rules}. Past learnings: ${prior ? `${prior.slug} from ${prior.unitName}` : `none on ${comp} yet`}. Not fixed; over to the implementer.`;
  return finish(seq, unitId, orderId, text, 5500 + Math.floor(rand() * 1500), 1500 + Math.floor(rand() * 2500));
}

// Workflow tester (testfirst): write the failing regression test and the acceptance check; no fix.
function testerScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, rand: () => number): Step[] {
  const comp = o.component ?? "core", f = flavorFor(o.component), issue = o.issue ?? "the issue", a = act(unitId, orderId);
  const name = `${(o.issue ?? comp).toLowerCase()}: ${f.change ? f.change.replace(/^add a regression test that /, "") : `the ${comp} edge case holds`}`;
  const check = `bun test ${f.test} passes, including "${name}"${f.ruleSlug ? `, and the fix follows ${f.ruleSlug}` : ""}`;
  const seq: Seq = [
    [0.05, a("thinking", `Test first for ${issue}: pin the bug down before anyone fixes it.`)],
    [0.18, a("tool", `Recalling the ${comp} house rules`, "gbrain.recall", { query: `${comp} ${o.title ?? ""}`.trim(), slugs: [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : []), ...(o.issue ? [`issues/${o.issue.toLowerCase()}`] : [])] })],
    [0.34, a("tool", `Reading ${f.test}`, "read_file", { path: f.test })],
    [0.52, a("tool", `Writing the regression test in ${f.test}`, "edit_file", { path: f.test })],
    [0.68, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
    [0.80, a("message", `The new test fails as expected: ${f.symptom ?? `the ${comp} edge case fails`}.`)],
  ];
  const text = `${unitName}: failing test for ${issue} in ${f.test}: "${name}". It fails today (${f.symptom ?? "the bug reproduces"}). Acceptance check: ${check}. Not fixed; over to the implementer.`;
  return finish(seq, unitId, orderId, text, 5000 + Math.floor(rand() * 1500), 1500 + Math.floor(rand() * 2000));
}

// Workflow herald: the customer update after approval, in the house tone.
function heraldScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, rand: () => number): Step[] {
  const comp = o.component ?? "core", issue = o.issue ?? "the issue", a = act(unitId, orderId);
  const c = CUSTOMER[comp] ?? { broke: o.title ? o.title.charAt(0).toLowerCase() + o.title.slice(1) : `an issue in ${comp}`, fixed: "we fixed the cause and added a test so it stays fixed", action: "Nothing." };
  const names = o.customers.map(titleCase);
  const to = names.length ? names.join(", ") : "affected customers";
  const seq: Seq = [
    [0.05, a("thinking", `Writing the customer update for ${issue} to ${to}.`)],
    [0.18, a("tool", `Recalling ${issue} and the affected customers`, "gbrain.recall", { query: `${issue} customers ${comp}`, slugs: [...(o.issue ? [`issues/${o.issue.toLowerCase()}`] : []), ...o.customers] })],
    ...o.customers.slice(0, 3).map((slug, i) => [0.30 + i * 0.08, a("tool", `Reading ${slug}`, "gbrain.get_page", { slug })] as [number, BridgeEvent]),
    [0.62, a("tool", "Searching GBrain for the house tone for customer updates", "gbrain.search", { query: "house tone customer update", slugs: [] })],
    [0.80, a("message", `Update drafted for ${to}: plain words, no blame, one clear next step.`)],
  ];
  // the reply starts with the update itself (the board shows it as the customer message)
  const text = [
    `Subject: Fixed: ${o.title ?? `${comp} issue ${issue}`}`,
    `To: ${to}`,
    names.length === 1 ? `Hi ${names[0]} team,` : "Hi there,",
    `What broke: ${c.broke}.`,
    `What we fixed: ${c.fixed}.`,
    `What you need to do: ${c.action}`,
    "Thanks for your patience; reply to this email if anything still looks off.",
    `${unitName}, for the Lumen team (${issue})`,
  ].join("\n");
  return finish(seq, unitId, orderId, text, 5000 + Math.floor(rand() * 1500), 1200 + Math.floor(rand() * 1800));
}

// Workflow judge (duel): compare the two latest implementer replies, pick one; ends with the verdict line.
function judgeScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, verdict: "approved" | "changes", rand: () => number): Step[] {
  const comp = o.component ?? "core", f = flavorFor(o.component), issue = o.issue ?? "the issue", a = act(unitId, orderId);
  const byUnit = new Map<string, Prev>();
  for (const p of o.previous) if (p.role !== "judge" && p.role !== "reviewer" && !/VERDICT:/i.test(p.reply)) byUnit.set(p.unitId, p);
  const rivals = [...byUnit.values()].slice(-2);
  const label = (p?: Prev) => (p ? p.name ?? p.unitId : "the implementer");
  const score = (p: Prev) => (f.ruleSlug && p.reply.includes(f.ruleSlug) ? 2 : 0) + (/regression test|test/i.test(p.reply) ? 1 : 0) + (/learnings\//.test(p.reply) ? 1 : 0);
  const [x, y] = rivals;
  const winner = !y ? x : score(y) > score(x!) ? y : score(x!) > score(y) ? x : rand() < 0.5 ? x : y;
  const loser = winner === x ? y : x;
  const seq: Seq = [
    [0.05, a("thinking", `Judging the ${issue} duel${rivals.length === 2 ? `: ${label(x)} vs ${label(y)}` : ""}.`)],
    [0.18, a("tool", `Recalling the ${comp} house rules`, "gbrain.recall", { query: `${comp} house rules`, slugs: [`components/${comp}`, ...(f.ruleSlug ? [f.ruleSlug] : [])] })],
    ...(f.ruleSlug ? [[0.30, a("tool", `Reading ${f.ruleSlug}`, "gbrain.get_page", { slug: f.ruleSlug })] as [number, BridgeEvent]] : []),
    [0.44, a("tool", `Reading both diffs in ${f.file}`, "read_file", { path: f.file })],
    [0.60, a("tool", `Running ${f.test} on both branches`, "run_tests", { path: f.test })],
    [0.80, a("message", verdict === "changes" ? `Neither fix is acceptable yet: ${f.change ?? `cover the ${comp} edge case with a test`}.` : `${label(winner)} wins: it follows the rule (${f.rule}).`)],
  ];
  const text = verdict === "changes"
    ? `${unitName}: compared both fixes for ${issue} against the ${comp} house rules. Neither proves the rule yet.\nVERDICT: CHANGES: ${f.change ?? `add a regression test for the ${comp} edge case in ${f.test}`}`
    : [
        `${unitName}: compared both fixes for ${issue} against the ${comp} house rules.`,
        `${label(winner)} wins: it follows the rule (${f.rule}) and proves it in ${f.test}.`,
        loser ? `${label(loser)}'s fix also passes, but it relies less clearly on the house rule.` : `Only one fix arrived, and it holds up.`,
        `VERDICT: APPROVED (winner: ${label(winner)})`,
      ].join("\n");
  return finish(seq, unitId, orderId, text, 5000 + Math.floor(rand() * 1500), 1800 + Math.floor(rand() * 2500));
}

// Demo story (MOCK_SCRIPT=demo), the safety net when QM is down. Wave 1 on a component: recall finds no learning,
// the first attempt fails, the agent finds the house rule and remembers a learning that states it (linked to the
// rule page). Wave 2 on the same component: recall includes that exact learning slug, it is read and applied at
// once, and the reply quotes it.
function demoScript(unitId: string, unitName: string, o: OrderInfo, orderId: string, learnings: Learning[], now: number, rand: () => number): Step[] {
  const comp = o.component ?? "core";
  const f = flavorFor(o.component);
  const issue = o.issue ?? "the issue";
  const title = o.title ?? `work on ${comp}`;
  const issueSlug = o.issue ? `issues/${o.issue.toLowerCase()}` : null;
  const learnSlug = o.learningSlug ?? `learnings/${slugify(o.issue ?? comp)}-${slugify(unitId)}-${now}`;
  const a = (kind: "message" | "tool" | "thinking" | "error", text: string, tool?: string, args?: unknown): BridgeEvent =>
    tool ? { type: "activity", unitId, orderId, kind, text, tool, args } : { type: "activity", unitId, orderId, kind, text };
  const base = [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), ...o.customers];
  const links = [`components/${comp}`, ...(issueSlug ? [issueSlug] : []), ...(f.ruleSlug ? [f.ruleSlug] : []), `units/${unitId}`];
  const learnText = `${f.rule} (${issue}: ${f.symptom ?? "the first fix missed this"} otherwise).`;
  const seq: Array<[number, BridgeEvent]> = [];
  const prior = learnings.find((l) => l.component === comp); // the first (rule) learning, not later confirmations
  let total: number, reply: string;

  if (!prior) {
    seq.push(
      [0.03, a("thinking", `Reading the order: ${issue} "${title}" in ${comp}.`)],
      [0.10, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall", { query: `${comp} ${title}`, slugs: base })],
      [0.17, a("message", `GBrain has no past learning on ${comp} yet. Trying the obvious fix.`)],
      [0.24, a("tool", `Reading ${f.file}`, "read_file", { path: f.file })],
      [0.31, a("tool", `Editing ${f.file}`, "edit_file", { path: f.file })],
      [0.38, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
      [0.44, a("message", `First attempt fails: ${f.symptom ?? "the test still fails"}.`)],
      [0.51, a("tool", `Searching GBrain for ${comp} house rules`, "gbrain.search", { query: `${comp} house rules`, slugs: f.ruleSlug ? [f.ruleSlug] : [] })],
      [0.58, a("message", `Found the house rule: ${f.rule}.`)],
      [0.65, a("tool", `Editing ${f.file} again`, "edit_file", { path: f.file })],
      [0.72, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
      [0.79, a("message", `Tests pass. I ${f.fix}.`)],
      [0.86, a("tool", `Remembering the rule so the next agent gets it right first time`, "gbrain.remember", { slug: learnSlug, text: learnText, links })],
    );
    if (f.ruleSlug) seq.push([0.92, a("tool", `Linking ${learnSlug} to ${f.ruleSlug}`, "gbrain.add_link", { from: learnSlug, to: f.ruleSlug, linkType: "mentions" })]);
    total = 8500 + Math.floor(rand() * 1500);
    reply = `${unitName}: fixed ${issue} "${title}" on the second attempt. My first fix failed because ${f.symptom ?? "I missed a house rule"}; the rule is: ${f.rule}. I saved it to GBrain as ${learnSlug} so the next agent gets it right first time.`;
  } else {
    seq.push(
      [0.03, a("thinking", `Reading the order: ${issue} "${title}" in ${comp}.`)],
      [0.12, a("tool", `Recalling what the team knows about ${comp} and ${issue}`, "gbrain.recall", { query: `${comp} ${title}`, slugs: [...base, prior.slug] })],
      [0.22, a("tool", `Reading ${prior.slug}`, "gbrain.get_page", { slug: prior.slug })],
      [0.32, a("message", `${prior.unitName} already learned this in ${prior.slug}: "${prior.text}" Applying it first try.`)],
      [0.44, a("tool", `Reading ${f.file}`, "read_file", { path: f.file })],
      [0.56, a("tool", `Editing ${f.file}`, "edit_file", { path: f.file })],
      [0.68, a("tool", `Running ${f.test}`, "run_tests", { path: f.test })],
      [0.78, a("message", `Tests pass on the first attempt. I ${f.fix}.`)],
      [0.88, a("tool", `Remembering that the learning held for ${issue}`, "gbrain.remember", { slug: learnSlug, text: `Applied ${prior.slug} to ${issue}; it held on the first attempt.`, links: [...links, prior.slug] })],
    );
    total = 6000 + Math.floor(rand() * 1000);
    reply = `${unitName}: fixed ${issue} "${title}" on the first attempt by recalling ${prior.slug} from ${prior.unitName}: "${prior.text}" Saved the confirmation as ${learnSlug}.`;
  }
  const tokens = 2000 + Math.floor(rand() * 6000);
  seq.push([0.99, { type: "usage", unitId, tokens, usd: usd(tokens) }]);
  if (o.reviewChange) reply += ` Applied the review change: ${o.reviewChange}.`;
  seq.push([1.0, { type: "reply", unitId, orderId, text: reply }]);
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
