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

/**
 * Keeps el's children in sync with items (newest last), reusing row nodes: in the usual case old rows
 * drop off the front and new ones append, so rows (and chips in them) never move under the cursor.
 */
export class RowList<T> {
  private shown: T[] = [];
  constructor(private el: HTMLElement, private row: (item: T) => HTMLElement) {}

  set(items: T[]): void {
    const shown = this.shown;
    const keep = shown.length ? items.indexOf(shown[shown.length - 1]) + 1 : 0;
    const drop = shown.length - keep;
    const prefixOk = keep > 0 && drop >= 0 && items.slice(0, keep).every((it, i) => it === shown[drop + i]);
    if (prefixOk && this.el.children.length === shown.length) {
      for (let i = 0; i < drop; i++) this.el.firstElementChild?.remove();
      for (const it of items.slice(keep)) this.el.append(this.row(it));
    } else {
      this.el.replaceChildren(...items.map((it) => this.row(it)));
    }
    this.shown = items.slice();
  }

  reset(): void {
    this.shown = [];
    clear(this.el);
  }
}
