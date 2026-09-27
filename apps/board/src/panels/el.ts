// Minimal DOM helper for panels/: strings become text nodes, never HTML (agent and brain text is untrusted).
type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, any> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else (el as any)[k] = v;
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

/** Renders brain markdown safely: headings, bullets, paragraphs, [[slug]] / [[slug|label]] links, `code`, **bold**.
 *  labelOf names a link by its page title instead of its slug. */
export function renderMarkdown(body: string, onLink: (slug: string) => void, labelOf: (slug: string) => string = (s) => s): HTMLElement {
  const root = h("div", { class: "pnl-md" });
  const inline = (text: string): Node[] => {
    const out: Node[] = [];
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|`([^`]+)`|\*\*([^*]+)\*\*/g;
    let last = 0;
    for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        const slug = m[1].trim();
        out.push(h("a", { class: "pnl-link", href: "#", title: slug, onclick: (e: Event) => { e.preventDefault(); onLink(slug); } }, m[2]?.trim() || labelOf(slug)));
      } else if (m[3]) out.push(h("code", {}, m[3]));
      else if (m[4]) out.push(h("b", {}, m[4]));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    return out;
  };
  let list: HTMLElement | null = null;
  for (const raw of body.replace(/^---[\s\S]*?\n---\n?/, "").split("\n")) {
    const line = raw.trimEnd();
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    const bm = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bm) {
      if (!list) root.append((list = h("ul")));
      list.append(h("li", {}, ...inline(bm[1]!)));
      continue;
    }
    list = null;
    if (hm) root.append(h(hm[1]!.length <= 2 ? "h4" : "h5", {}, ...inline(hm[2]!)));
    else if (line.trim()) root.append(h("p", {}, ...inline(line)));
  }
  return root;
}

/** Relative time in game voice: "now", "12s", "3m", "2h", "4d". */
export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Markdown to one line of plain text for snippets: links by label, no heading marks, code ticks or bold stars. */
export function plainText(md: string, labelOf: (slug: string) => string = (s) => s): string {
  return md
    .replace(/^---[\s\S]*?\n---\n?/, "")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug: string, label?: string) => label?.trim() || labelOf(slug.trim()))
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/[`*]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
