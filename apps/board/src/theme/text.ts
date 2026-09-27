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
  const words = last.split(/[-_]/).filter(Boolean).map((w) => (/^[a-z]{2,5}\d*$/i.test(w) && w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)));
  return words.join(" ") || (dir in DIRS ? dir : slug);
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
