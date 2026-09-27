// Knowledge graph view for the Library panel: a small force layout drawn on a 2D canvas.
// Nodes glow blue when recalled and gold when remembered (driven by memory.* events).
// Redraws on resize (ResizeObserver) and on hover, so a canvas sized late or re-opened is never left blank.
import type { GraphNode, GraphEdge } from "../core";

/** Node colour per page type, tuned for the dark field. Learnings use a muted gold (they are what remember writes). */
export const TYPE_COLORS: Record<string, string> = {
  product: "#e0b454", component: "#7fb0d9", rule: "#d65a45", issue: "#e39a3b", company: "#7cc47f",
  person: "#b08ce8", learning: "#b9a676", unit: "#8b8f96",
};
export const TYPE_LABELS: Record<string, string> = {
  product: "Product", component: "Component", rule: "Rule", issue: "Issue", company: "Customer",
  person: "Person", learning: "Learning", unit: "Agent",
};
const ALWAYS_LABEL = new Set(["product", "component", "rule", "issue"]);
const FONT = '600 11px "Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';

interface N extends GraphNode { x: number; y: number; vx: number; vy: number; glow: number; glowColor: string; deg: number }

export class GraphView {
  readonly canvas: HTMLCanvasElement;
  private nodes: N[] = [];
  private edges: { a: N; b: N; type: string }[] = [];
  private byId = new Map<string, N>();
  private hover: N | null = null;
  private selected: string | null = null;
  private raf = 0;
  private heat = 1;
  // View on top of the fit-to-box transform: wheel zooms around the cursor, drag pans, double-click resets.
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  /** Hover card, positioned inside the canvas's parent (which must be position: relative). */
  readonly tip: HTMLElement;
  /** Full title for the hover card and page lookups (e.g. unit ids to names); falls back to the node title. */
  label: (n: GraphNode) => string = (n) => n.title || n.id;
  /** Short on-canvas label: "LUM-101" for issues, the title without its "Rule:" prefix for rules. */
  short: (n: GraphNode) => string = (n) => {
    const t = this.label(n);
    if (n.type === "issue") return /^([A-Z]+-\d+)/.exec(t)?.[1] ?? t;
    return t;
  };

  constructor(private onPick: (slug: string) => void) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pnl-graph";
    this.tip = document.createElement("div");
    this.tip.className = "pnl-gtip";
    this.tip.hidden = true;
    this.canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener("mouseup", () => { if (this.drag) { this.canvas.style.cursor = ""; setTimeout(() => { this.drag = null; }, 0); } });
    this.canvas.addEventListener("mousemove", (e) => {
      if (this.drag && (e.buttons & 1)) {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
        if (this.drag.moved || Math.abs(dx) + Math.abs(dy) > 3) {
          this.drag.moved = true; this.panX += dx; this.panY += dy; this.drag.x = e.clientX; this.drag.y = e.clientY;
          this.canvas.style.cursor = "grabbing"; this.setHover(null); this.start(); return;
        }
      }
      const n = this.pick(e);
      this.canvas.style.cursor = n ? "pointer" : "grab";
      this.setHover(n);
    });
    this.canvas.addEventListener("mouseleave", () => this.setHover(null));
    this.canvas.addEventListener("click", (e) => {
      if (this.drag?.moved) return;
      const n = this.pick(e);
      if (n) { this.selected = n.id; this.onPick(n.id); }
    });
    this.canvas.addEventListener("dblclick", () => { this.zoom = 1; this.panX = this.panY = 0; this.start(); });
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(5, Math.max(0.6, this.zoom * Math.exp(-e.deltaY * 0.0015)));
      const f = k / this.zoom;
      // Keep the point under the cursor still: screen = fit * zoom + pan (around the canvas centre).
      const cx = r.width / 2, cy = r.height / 2;
      this.panX = (mx - cx) - ((mx - cx) - this.panX) * f;
      this.panY = (my - cy) - ((my - cy) - this.panY) * f;
      this.zoom = k;
      this.setHover(null);
      this.start();
    }, { passive: false });
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.start()).observe(this.canvas);
  }

  get size(): { nodes: number; edges: number } { return { nodes: this.nodes.length, edges: this.edges.length }; }
  /** Node types present, with counts, in legend order. */
  types(): [string, number][] {
    const c = new Map<string, number>();
    for (const n of this.nodes) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }
  title(slug: string): string | null { const n = this.byId.get(slug); return n ? this.label(n) : null; }
  type(slug: string): string | null { return this.byId.get(slug)?.type ?? null; }

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    const old = this.byId;
    this.byId = new Map();
    this.nodes = nodes.map((n, i) => {
      const prev = old.get(n.id);
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const node: N = prev ? { ...prev, ...n, deg: 0 } : { ...n, x: Math.cos(a) * 120, y: Math.sin(a) * 120, vx: 0, vy: 0, glow: 0, glowColor: "", deg: 0 };
      this.byId.set(n.id, node);
      return node;
    });
    this.edges = edges.flatMap((e) => {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      if (!a || !b) return [];
      a.deg++; b.deg++;
      return [{ a, b, type: e.type }];
    });
    // Settle synchronously so nodes are still (and clickable) by the first frame.
    this.heat = old.size ? 0.4 : 1;
    for (let i = 0; i < 300 && this.heat > 0.03; i++) this.step();
    this.heat = Math.min(this.heat, 0.03);
    this.start();
  }

  flash(slugs: string[], color: string): void {
    for (const s of slugs) {
      const n = this.byId.get(s);
      if (n) { n.glow = 1; n.glowColor = color; }
    }
    this.start();
  }

  select(slug: string | null): void { this.selected = slug; this.start(); }

  private setHover(n: N | null): void {
    if (n === this.hover) return;
    this.hover = n;
    this.start();
  }

  /** Hover card: type, full title, link count; placed beside the node and kept inside the field. */
  private placeTip(n: N | null, x = 0, y = 0, w = 0): void {
    if (!n) { this.tip.hidden = true; this.tipFor = null; return; }
    if (this.tipFor !== n) this.fillTip(n);
    const tw = this.tip.offsetWidth || 200;
    const left = x + 14 + tw > w ? x - 14 - tw : x + 14;
    this.tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(y - 12)}px)`;
  }

  private tipFor: N | null = null;
  private fillTip(n: N): void {
    this.tipFor = n;
    const color = TYPE_COLORS[n.type] ?? "#8b8f96";
    this.tip.replaceChildren();
    const tag = document.createElement("span");
    tag.className = "pnl-gtip-type"; tag.style.color = color; tag.textContent = TYPE_LABELS[n.type] ?? n.type;
    const title = document.createElement("b"); title.textContent = this.label(n);
    const meta = document.createElement("small"); meta.textContent = `${n.deg} ${n.deg === 1 ? "link" : "links"}`;
    this.tip.append(tag, title, meta);
    this.tip.hidden = false;
  }

  start(): void { if (!this.raf) this.raf = requestAnimationFrame(this.tick); }
  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = () => {
    this.raf = 0;
    if (!this.canvas.isConnected) return;
    if (this.heat > 0.02) this.step();
    this.draw();
    const glowing = this.nodes.some((n) => n.glow > 0.01);
    if (this.heat > 0.02 || glowing) this.raf = requestAnimationFrame(this.tick);
  };

  private step(): void {
    const ns = this.nodes;
    for (let i = 0; i < ns.length; i++) {
      const a = ns[i]!;
      for (let j = i + 1; j < ns.length; j++) {
        const b = ns[j]!;
        let dx = a.x - b.x, dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const f = 1400 / d2;
        const d = Math.sqrt(d2);
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const e of this.edges) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 60) * 0.02;
      e.a.vx += (dx / d) * f; e.a.vy += (dy / d) * f; e.b.vx -= (dx / d) * f; e.b.vy -= (dy / d) * f;
    }
    for (const n of ns) {
      // Loose pages (no links) get a stronger pull so they do not fly off and shrink the whole view.
      const k = n.deg ? 0.004 : 0.012;
      n.vx -= n.x * k; n.vy -= n.y * k;
      n.x += n.vx * this.heat; n.y += n.vy * this.heat;
      n.vx *= 0.6; n.vy *= 0.6;
    }
    this.heat *= 0.99;
  }

  private transform() {
    const c = this.canvas;
    const w = c.clientWidth, hgt = c.clientHeight;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of this.nodes) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x); minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y); }
    if (!this.nodes.length) { minX = minY = -1; maxX = maxY = 1; }
    const fit = Math.min((w - 120) / Math.max(1, maxX - minX), (hgt - 64) / Math.max(1, maxY - minY), 2.6);
    const s = fit * this.zoom;
    const ox = w / 2 - ((minX + maxX) / 2) * s + this.panX, oy = hgt / 2 - ((minY + maxY) / 2) * s + this.panY;
    return { s, ox, oy, w, hgt };
  }

  private radius(n: N): number {
    const base = n.type === "product" ? 7 : n.type === "component" ? 6 : n.type === "rule" ? 5 : 3.5;
    return base + Math.min(4, Math.sqrt(n.deg) * 0.6);
  }

  private pick(e: MouseEvent): N | null {
    const r = this.canvas.getBoundingClientRect();
    const { s, ox, oy } = this.transform();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: N | null = null, bd = 12 * 12;
    for (const n of this.nodes) {
      const dx = n.x * s + ox - mx, dy = n.y * s + oy - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  private draw(): void {
    const c = this.canvas;
    const { s, ox, oy, w, hgt } = this.transform();
    if (!w || !hgt) return; // not laid out yet; the ResizeObserver redraws once it is
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);

    const focus = this.hover ?? (this.selected ? this.byId.get(this.selected) ?? null : null);
    const near = new Set<N>();
    if (focus) {
      near.add(focus);
      for (const e of this.edges) { if (e.a === focus) near.add(e.b); else if (e.b === focus) near.add(e.a); }
    }
    const P = (n: N) => [n.x * s + ox, n.y * s + oy] as const;

    // Links: quiet brass hairlines; the focused node's links light up.
    g.lineWidth = 1;
    g.strokeStyle = focus ? "rgba(200,173,122,.07)" : "rgba(200,173,122,.16)";
    g.beginPath();
    for (const e of this.edges) {
      if (focus && (e.a === focus || e.b === focus)) continue;
      const [ax, ay] = P(e.a), [bx, by] = P(e.b);
      g.moveTo(ax, ay); g.lineTo(bx, by);
    }
    g.stroke();
    if (focus) {
      g.strokeStyle = "rgba(224,180,84,.75)";
      g.lineWidth = 1.25;
      g.beginPath();
      for (const e of this.edges) {
        if (e.a !== focus && e.b !== focus) continue;
        const [ax, ay] = P(e.a), [bx, by] = P(e.b);
        g.moveTo(ax, ay); g.lineTo(bx, by);
      }
      g.stroke();
    }

    // Nodes
    for (const n of this.nodes) {
      const [x, y] = P(n);
      const r = this.radius(n);
      const dim = focus && !near.has(n);
      if (n.glow > 0.01) {
        const gr = g.createRadialGradient(x, y, r, x, y, r + 18 * n.glow);
        gr.addColorStop(0, n.glowColor);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = n.glow * 0.9;
        g.fillStyle = gr;
        g.beginPath(); g.arc(x, y, r + 18 * n.glow, 0, Math.PI * 2); g.fill();
        n.glow *= 0.975;
      }
      g.globalAlpha = dim ? 0.3 : 1;
      g.fillStyle = TYPE_COLORS[n.type] ?? "#8b8f96";
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = 1;
      g.strokeStyle = "rgba(8,10,14,.85)";
      g.stroke();
      if (n.id === this.selected || n === this.hover) {
        g.strokeStyle = "#ece6d8";
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, r + 3, 0, Math.PI * 2); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // Labels in priority order (focus, selection, key pages, neighbours); a label that would overlap one
    // already drawn is skipped, so the field never turns into a pile of text. Dark halo for legibility.
    g.font = FONT;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    g.lineJoin = "round";
    const rank = (n: N) => n === focus ? 0 : n.id === this.selected ? 1 : n.type === "product" ? 2 : n.type === "component" ? 3 : near.has(n) ? 4 : n.type === "rule" ? 5 : 6;
    const cands = this.nodes.filter((n) => ALWAYS_LABEL.has(n.type) || near.has(n) || n.id === this.selected).sort((a, b) => rank(a) - rank(b));
    const taken: [number, number, number, number][] = [];
    for (const n of cands) {
      const [x, y] = P(n);
      const t = (n.type === "product" || n.type === "component" ? this.short(n).toUpperCase() : this.short(n));
      const tw = g.measureText(t).width, ty = y - this.radius(n) - 4;
      const box: [number, number, number, number] = [x - tw / 2 - 3, ty - 13, x + tw / 2 + 3, ty + 1];
      if (rank(n) > 1 && taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      taken.push(box);
      g.globalAlpha = focus && !near.has(n) ? 0.35 : 1;
      g.lineWidth = 3.5;
      g.strokeStyle = "rgba(8,10,14,.92)";
      g.strokeText(t, x, ty);
      g.fillStyle = n === focus ? "#ffffff" : n.type === "product" ? "#e9cf8f" : n.type === "component" ? "#e8e2d4" : "#c9c4b8";
      g.fillText(t, x, ty);
      g.globalAlpha = 1;
    }
    if (this.hover) { const [x, y] = P(this.hover); this.placeTip(this.hover, x, y, w); } else this.placeTip(null);
  }
}
