// Tiny DOM builder. Strings always become text nodes, never HTML, so agent text is safe.
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  append(el, children);
  return el;
}

// Like el.append, but skips null/false children (for conditional sections).
export function put(el: HTMLElement, ...children: (Child | Child[])[]): void {
  append(el, children);
}

function append(el: HTMLElement, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// Only http(s) links may become hrefs (sessionUrl comes from the backend).
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, location.href);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

export function timeOf(ts: string | number | undefined): string {
  const d = ts === undefined ? new Date() : new Date(ts);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Colours from the backend go into style attributes; allow only hex colours.
export function safeColor(c: string | null | undefined, fallback = "#8a7a5c"): string {
  return c && /^#[0-9a-f]{3,8}$/i.test(c) ? c : fallback;
}
