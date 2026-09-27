// Game-voice text helpers: relative times, human page titles from brain slugs, name-prefix stripping.

/** "now", "12s", "3m", "2h", "4d". */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Keeps every [data-ts] element under root showing its relative time (call on an interval). */
export function refreshTimes(root: ParentNode): void {
  const now = Date.now();
  root.querySelectorAll<HTMLElement>("[data-ts]").forEach((el) => {
    const t = relTime(Number(el.dataset.ts), now);
    if (el.textContent !== t) el.textContent = t;
  });
}

const ACRONYMS = new Set(["api", "qm", "sso", "ui", "db", "ci", "sla", "pii", "csv", "url", "id"]);
const DIRS: Record<string, string> = { learnings: "", issues: "", components: "", rules: "", customers: "", people: "", concepts: "" };

/** "learnings/lum-101-u3-1790547859718" -> "LUM-101 learning"; "rules/billing-idempotency" -> "Billing Idempotency". */
export function pageTitle(slug: string): string {
  const parts = slug.split("/");
  const dir = parts.length > 1 ? parts[0] : "";
  let last = parts[parts.length - 1] || slug;
  last = last.replace(/-\d{9,}$/, "").replace(/-u\d+$/, ""); // epoch and unit suffixes
  const issue = /^([a-z]{2,5})-(\d+)$/i.exec(last);
  if (issue) {
    const id = `${issue[1].toUpperCase()}-${issue[2]}`;
    return dir === "learnings" ? `${id} learning` : id;
  }
  const words = last.split(/[-_]/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
  const title = words.join(" ");
  if (dir === "learnings") return title ? `${title} learning` : "Learning";
  return title || (dir in DIRS ? dir : slug);
}

/** Drops a leading "<name>:" the agent put in front of its own text ("Ada: plan ..." -> "plan ..."). */
export function stripName(text: string, name: string | undefined): string {
  if (!name) return text;
  const t = text.trimStart();
  return t.toLowerCase().startsWith(`${name.toLowerCase()}:`) ? t.slice(name.length + 1).trimStart() : text;
}

/** First line, without markdown list or heading marks. */
export function firstLine(text: string): string {
  return (text.split("\n").find((l) => l.trim()) ?? "").replace(/^\s*(#+|\d+\.|[-*])\s*/, "").trim();
}

const SLUG_IN_TEXT = /\b(?:rules|learnings|issues|components|customers|people|concepts|decisions|runbooks)\/[a-z0-9][a-z0-9-]*/gi;

/** Engine and agent text for players: slugs become page titles, internal notes go. */
export function humanize(text: string): string {
  return text
    .replace(/\s*\((?:engine )?fallback\)/gi, "")
    .replace(/\b([A-Z][\w-]*):\s+\1:\s*/g, "$1: ") // "received from Ada: Ada: plan" -> "received from Ada: plan"
    .replace(SLUG_IN_TEXT, (m) => pageTitle(m));
}

// Forged units answer in house-style sections ("Recall: ...", "Plan: ...", "Decision: ..."; see services/forge).
const SECTION = /^\s*(?:#+\s*)?\**\s*(Recall|Plan|Decision|Customer (?:reply|update)|Remember|Rules|Finding)\s*\**\s*:\s*\**\s*(.*)$/i;
const GIST: [string, string][] = [["decision", "decided"], ["finding", "found"], ["plan", "planned"], ["customer reply", "wrote"],
  ["customer update", "wrote"], ["remember", "learned"], ["rules", "applied"], ["recall", "recalled"]];

/** A sectioned reply as one feed phrase from its most telling section: ["decided", "reuse the invoice key"]; null if unsectioned. */
export function replyGist(text: string): [string, string] | null {
  const found = new Map<string, string>();
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = SECTION.exec(line);
    if (!m) return;
    const body = (m[2].trim() || lines.slice(i + 1).find((l) => l.trim() && !SECTION.test(l)) || "").replace(/\*+/g, "").replace(/^\s*(?:\d+\.|[-*])\s*/, "").trim();
    if (body && !found.has(m[1].toLowerCase())) found.set(m[1].toLowerCase(), body);
  });
  for (const [k, verb] of GIST) {
    const body = found.get(k);
    if (body) return [verb, dropCustomerSlugs(humanize(body))];
  }
  return null;
}

/** "LUM-101 in billing for acme-corp, globex" -> "LUM-101 in billing": raw customer ids are not player text. */
function dropCustomerSlugs(text: string): string {
  return text.replace(/\s+for\s+[a-z0-9]+(?:-[a-z0-9]+)+(?:\s*(?:,|and)\s*[a-z0-9]+(?:-[a-z0-9]+)*)*/g, "").trim();
}

/** "order active: LUM-101 Payment retry" -> "took LUM-101"; "workflow done: LUM-101" -> "finished LUM-101". */
export function orderPhrase(text: string): string {
  const m = /^(order|workflow) (\w+): (\S+)(.*)$/.exec(text);
  if (!m) return humanize(text);
  const verb = ({ proposed: "proposed", active: "took", done: "finished", cancelled: "dropped", failed: "failed", running: "started",
    needs_human: "needs you on", } as Record<string, string>)[m[2]] ?? m[2];
  return `${verb} ${m[3]}`;
}

/** A tool call as a short verb phrase: read a file, edited a file, ran tests, read Billing Idempotency. */
export function toolPhrase(tool: string | undefined, text: string, slugs?: string[]): string {
  const t = (tool ?? "").toLowerCase().replace(/^mcp__[a-z0-9-]+__/, "").replace(/^[a-z0-9-]+\./, "");
  const page = slugs?.find((s) => typeof s === "string" && s) ?? (text.match(SLUG_IN_TEXT) ?? [])[0];
  if (/gbrain/.test(tool ?? "") || /_page|^page|recall|remember/.test(t)) {
    if (/put|write|remember|create|update|link/.test(t)) return page ? `wrote ${pageTitle(page)}` : "wrote to the Library";
    if (/search|query/.test(t)) return "searched the Library";
    return page ? `read ${pageTitle(page)}` : "read the Library";
  }
  if (/test/.test(t)) return "ran tests";
  if (/edit|write|patch|replace|create/.test(t)) return "edited a file";
  if (/read|view|cat|open/.test(t)) return "read a file";
  if (/grep|glob|find|search|list|ls/.test(t)) return "searched the code";
  if (/bash|shell|exec|run|command/.test(t)) return "ran a command";
  if (/web|fetch|http/.test(t)) return "fetched a page";
  return t ? `used ${t.replace(/[_-]+/g, " ")}` : humanize(text);
}

/** Model line for players: River checkpoints (river://...) are not shown. */
export function modelLabel(model: string | null | undefined): string {
  return !model || /^river:\/\//.test(model) || model.length > 32 ? "" : model;
}
