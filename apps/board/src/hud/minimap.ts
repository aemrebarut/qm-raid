// Minimap: the 24 x 24 map as an isometric diamond matching the scene camera
// (tile 0,0 at the top vertex, x runs down-right, y down-left). Click centres the camera.
import type { Bus, State } from "../core";
import { h } from "./dom";

const MAP = 24;
const W = 220;
const H = 116;
const K = (W - 4) / (2 * MAP); // px per tile step
const CX = W / 2;
const TOP = (H - MAP * K) / 2;

// Tactical palette (Look tokens): dark field, muted zones, one accent per building system.
const BUILDING_COLOR: Record<string, string> = { gbrain: "#d9a441", barracks: "#a7adb4", river: "#4fa7e0" };
const ZONE_TINTS = ["#3c4a3a", "#474636", "#3a4843", "#4a3f38", "#394550", "#463c48", "#434a36", "#35463f"];

const toScreen = (x: number, y: number): [number, number] => [CX + (x - y) * K, TOP + ((x + y) * K) / 2];

export class Minimap {
  private canvas = h("canvas", { class: "hud-minimap-canvas", width: W, height: H, title: "Click to move the camera" });
  readonly root = h("div", { class: "hud-minimap" }, this.canvas);
  private ctx = this.canvas.getContext("2d");
  private last: State | null = null;
  private view: { x: number; y: number }[] = []; // camera footprint in tile coords (scene emits 'view')

  constructor(private bus: Bus) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    // CSS sizes the canvas to the bottom panel height (aspect ratio kept); clicks scale by its rect.
    this.ctx?.scale(dpr, dpr);
    bus.on("view", (v) => {
      this.view = Array.isArray(v?.corners) ? v.corners.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)) : [];
      if (this.last) this.draw(this.last);
    });
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const sy = ((e.clientY - r.top) / r.height) * H;
      const a = (sx - CX) / K; // x - y
      const b = ((sy - TOP) * 2) / K; // x + y
      const x = Math.floor((a + b) / 2);
      const y = Math.floor((b - a) / 2);
      if (x < 0 || y < 0 || x >= MAP || y >= MAP) return;
      this.bus.focusTile(x, y);
    });
  }

  draw(s: State): void {
    this.last = s;
    const c = this.ctx;
    if (!c) return;
    c.clearRect(0, 0, W, H);

    quad(c, 0, 0, MAP, MAP);
    c.fillStyle = "#222b24";
    c.fill();
    c.strokeStyle = "rgba(200,164,98,.45)";
    c.lineWidth = 1;
    c.stroke();

    s.components.forEach((comp, i) => {
      const z = comp.zone;
      quad(c, z.x, z.y, z.w, z.h);
      c.fillStyle = ZONE_TINTS[i % ZONE_TINTS.length];
      c.fill();
      c.strokeStyle = "rgba(236,230,216,.12)";
      c.lineWidth = 1;
      c.stroke();
    });

    for (const b of s.buildings) {
      const [x, y] = toScreen(b.x + 0.5, b.y + 0.5);
      c.beginPath();
      c.moveTo(x, y - 4); c.lineTo(x + 4, y); c.lineTo(x, y + 4); c.lineTo(x - 4, y); c.closePath();
      c.fillStyle = BUILDING_COLOR[b.kind] ?? "#a7adb4";
      c.fill();
      c.strokeStyle = "rgba(0,0,0,.8)";
      c.lineWidth = 1;
      c.stroke();
    }

    for (const t of s.targets) {
      if (t.status === "resolved") continue;
      const [x, y] = toScreen(t.pos.x + 0.5, t.pos.y + 0.5);
      dot(c, x, y, 1.4 + t.severity * 0.5, t.status === "engaged" ? "#e39a3b" : "#d65a45");
    }

    const selected = new Set(this.bus.selection.units);
    for (const u of s.units) {
      const [x, y] = toScreen(u.pos.x + 0.5, u.pos.y + 0.5);
      const team = s.teams.find((t) => t.id === u.team);
      dot(c, x, y, 2.4, team?.color ?? "#e8e0c8");
      if (selected.has(u.id)) {
        c.beginPath();
        c.arc(x, y, 4.2, 0, Math.PI * 2);
        c.strokeStyle = "#ece6d8";
        c.lineWidth = 1;
        c.stroke();
      }
    }

    // AoE view frame: the camera's ground footprint, clipped to the map.
    if (this.view.length >= 3) {
      c.save();
      quad(c, 0, 0, MAP, MAP);
      c.clip();
      c.beginPath();
      this.view.forEach((p, i) => (i ? c.lineTo(...toScreen(p.x, p.y)) : c.moveTo(...toScreen(p.x, p.y))));
      c.closePath();
      c.strokeStyle = "rgba(236,230,216,.6)";
      c.lineWidth = 1;
      c.stroke();
      c.restore();
    }
  }
}

function quad(c: CanvasRenderingContext2D, x: number, y: number, w: number, hgt: number): void {
  c.beginPath();
  c.moveTo(...toScreen(x, y));
  c.lineTo(...toScreen(x + w, y));
  c.lineTo(...toScreen(x + w, y + hgt));
  c.lineTo(...toScreen(x, y + hgt));
  c.closePath();
}

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = fill;
  c.fill();
  c.strokeStyle = "rgba(0,0,0,.8)";
  c.lineWidth = 0.8;
  c.stroke();
}
