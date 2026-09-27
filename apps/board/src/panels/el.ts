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

/** Renders brain markdown safely: headings, bullets, paragraphs, and [[slug]] / [[slug|label]] links. */
export function renderMarkdown(body: string, onLink: (slug: string) => void): HTMLElement {
  const root = h("div", { class: "pnl-md" });
  const inline = (text: string): Node[] => {
    const out: Node[] = [];
    const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let last = 0;
    for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      const slug = m[1]!.trim();
      out.push(h("a", { class: "pnl-link", href: "#", onclick: (e: Event) => { e.preventDefault(); onLink(slug); } }, m[2]?.trim() || slug));
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
