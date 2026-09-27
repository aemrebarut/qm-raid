// Knowledge graph view for the Library panel: a small force layout drawn on a 2D canvas.
// Nodes glow blue when recalled and gold when remembered (driven by memory.* events).
import type { GraphNode, GraphEdge } from "../core";

const COLORS: Record<string, string> = {
  product: "#c9a227", component: "#4a6fa5", rule: "#b33a3a", issue: "#d9822b", company: "#3f8f4f",
  person: "#8a5fb0", learning: "#e8c14a", unit: "#6b6b6b",
};

interface N extends GraphNode { x: number; y: number; vx: number; vy: number; glow: number; glowColor: string }

export class GraphView {
  readonly canvas: HTMLCanvasElement;
  private nodes: N[] = [];
  private edges: { a: N; b: N; type: string }[] = [];
  private byId = new Map<string, N>();
  private hover: N | null = null;
  private selected: string | null = null;
  private raf = 0;
  private heat = 1;

  constructor(private onPick: (slug: string) => void) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pnl-graph";
    this.canvas.addEventListener("mousemove", (e) => { this.hover = this.pick(e); this.canvas.style.cursor = this.hover ? "pointer" : "default"; });
    this.canvas.addEventListener("mouseleave", () => { this.hover = null; });
    this.canvas.addEventListener("click", (e) => { const n = this.pick(e); if (n) { this.selected = n.id; this.onPick(n.id); } });
  }

  setData(nodes: GraphNode[], edges: GraphEdge[]): void {
    const old = this.byId;
    this.byId = new Map();
    this.nodes = nodes.map((n, i) => {
      const prev = old.get(n.id);
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      const node: N = prev ? { ...prev, ...n } : { ...n, x: Math.cos(a) * 120, y: Math.sin(a) * 120, vx: 0, vy: 0, glow: 0, glowColor: "" };
      this.byId.set(n.id, node);
      return node;
    });
    this.edges = edges.flatMap((e) => {
      const a = this.byId.get(e.from), b = this.byId.get(e.to);
      return a && b ? [{ a, b, type: e.type }] : [];
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

  start(): void { if (!this.raf) this.raf = requestAnimationFrame(this.tick); }
  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  private tick = () => {
    this.raf = 0;
    if (!this.canvas.isConnected) return;
    if (this.heat > 0.02) this.step();
    this.draw();
    const glowing = this.nodes.some((n) => n.glow > 0.01);
    if (this.heat > 0.02 || glowing || this.hover) this.raf = requestAnimationFrame(this.tick);
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
      n.vx -= n.x * 0.004; n.vy -= n.y * 0.004;
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
    const s = Math.min((w - 60) / Math.max(1, maxX - minX), (hgt - 40) / Math.max(1, maxY - minY), 2.2);
    const ox = w / 2 - ((minX + maxX) / 2) * s, oy = hgt / 2 - ((minY + maxY) / 2) * s;
    return { s, ox, oy, w, hgt };
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
    const dpr = window.devicePixelRatio || 1;
    const { s, ox, oy, w, hgt } = this.transform();
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    g.lineWidth = 1;
    for (const e of this.edges) {
      g.strokeStyle = e.type === "works_at" ? "rgba(63,143,79,.45)" : "rgba(80,60,30,.35)";
      g.beginPath(); g.moveTo(e.a.x * s + ox, e.a.y * s + oy); g.lineTo(e.b.x * s + ox, e.b.y * s + oy); g.stroke();
    }
    g.font = "11px Iowan Old Style, Palatino, Georgia, serif";
    g.textAlign = "center";
    for (const n of this.nodes) {
      const x = n.x * s + ox, y = n.y * s + oy;
      const r = n.type === "product" ? 9 : n.type === "component" ? 7 : 5;
      if (n.glow > 0.01) {
        g.fillStyle = n.glowColor;
        g.globalAlpha = n.glow * 0.6;
        g.beginPath(); g.arc(x, y, r + 12 * n.glow, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        n.glow *= 0.97;
      }
      g.fillStyle = COLORS[n.type] ?? "#777";
      g.strokeStyle = n.id === this.selected ? "#000" : "rgba(40,25,10,.7)";
      g.lineWidth = n.id === this.selected ? 2.5 : 1;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
      if (n.type === "product" || n.type === "component" || n === this.hover || n.id === this.selected) {
        g.fillStyle = "#2f2415";
        g.fillText(n.title || n.id, x, y - r - 4);
      }
    }
  }
}

export function legend(): HTMLElement {
  const el = document.createElement("div");
  el.className = "pnl-legend";
  for (const [type, color] of Object.entries(COLORS)) {
    const item = document.createElement("span");
    const dot = document.createElement("i");
    dot.style.background = color;
    item.append(dot, type);
    el.append(item);
  }
  return el;
}
