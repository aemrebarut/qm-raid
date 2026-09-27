// Team workflows in the world: role badges beside units that hold a workflow node, faint team-colour links
// along the graph edges while the team's run is running (active nodes glow, work marches out of them).
import * as THREE from "three";
import type { State, WorkflowRun } from "../core";
import type { UnitView } from "./units";
import { glowTexture } from "./fx";
import { SERIF } from "./util";

const ROLES: Record<string, { glyph: string; bg: string }> = {
  planner: { glyph: "\u{1F4DC}", bg: "#c9a227" },     // scroll
  implementer: { glyph: "\u{1F528}", bg: "#c8662c" }, // hammer
  reviewer: { glyph: "\u{1F441}", bg: "#3f73b8" },    // eye
};
const CUSTOM_BG = "#7b4fa3";
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const BADGE_OFF = SCREEN_RIGHT.clone().multiplyScalar(-0.5).setY(1.02); // beside the head, screen left
const SEG = new THREE.BoxGeometry(0.05, 0.03, 1);
const DOT = new THREE.SphereGeometry(0.07, 8, 6);
const N_SEG = 14;

const badgeTex = new Map<string, THREE.Texture>();
function badgeTexture(role: string) {
  const key = ROLES[role] ? role : `custom:${role}`;
  let t = badgeTex.get(key);
  if (t) return t;
  const spec = ROLES[role] ?? { glyph: (role.trim()[0] ?? "?").toUpperCase(), bg: CUSTOM_BG };
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  // Small shield: rounded top, pointed bottom
  ctx.beginPath();
  ctx.moveTo(8, 8); ctx.lineTo(56, 8); ctx.lineTo(56, 36);
  ctx.quadraticCurveTo(56, 52, 32, 60); ctx.quadraticCurveTo(8, 52, 8, 36);
  ctx.closePath();
  ctx.fillStyle = spec.bg;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#2b1d0e";
  ctx.stroke();
  ctx.fillStyle = "#fff8e6";
  ctx.font = `700 28px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.glyph, 32, 32);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  badgeTex.set(key, t);
  return t;
}

class Badge {
  readonly group = new THREE.Group();
  readonly sprite: THREE.Sprite;
  readonly glow: THREE.Sprite;
  active = false;
  constructor(readonly role: string, color: string) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTexture(role), depthTest: false, transparent: true }));
    this.sprite.scale.setScalar(0.38);
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 11;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.renderOrder = 10;
    this.glow.position.y = 0.19;
    this.glow.visible = false;
    this.group.add(this.glow, this.sprite);
  }
  dispose() { this.sprite.material.dispose(); this.glow.material.dispose(); }
}

class Link {
  readonly group = new THREE.Group();
  readonly mat: THREE.MeshBasicMaterial;
  private readonly segs: THREE.Mesh[] = [];
  private readonly dots: THREE.Mesh[] = [];
  hot = false; // work flows out of an active node along this edge
  constructor(readonly fromUnit: string, readonly toUnit: string, readonly on: string, color: string) {
    const c = new THREE.Color(color);
    if (on === "changes") c.lerp(new THREE.Color("#ff5a4a"), 0.45);
    this.mat = new THREE.MeshBasicMaterial({ color: c.lerp(new THREE.Color("#ffffff"), 0.15), transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
    for (let i = 0; i < N_SEG; i++) {
      const m = new THREE.Mesh(SEG, this.mat);
      m.renderOrder = 7;
      this.segs.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(DOT, this.mat);
      d.renderOrder = 7;
      this.dots.push(d);
      this.group.add(d);
    }
  }

  update(a: THREE.Vector3, b: THREE.Vector3, t: number) {
    const dist = a.distanceTo(b);
    const ctrl = a.clone().add(b).multiplyScalar(0.5);
    ctrl.y += 0.3 + dist * 0.12;
    // Changes edges bow sideways so a review loop reads as two lanes between the same pair.
    if (this.on === "changes") {
      const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(0.35 + dist * 0.08);
      ctrl.add(side);
    }
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    this.segs.forEach((m, i) => {
      curve.getPoint(i / N_SEG, p);
      curve.getPoint((i + 1) / N_SEG, q);
      m.position.copy(p).add(q).multiplyScalar(0.5);
      m.lookAt(q);
      m.scale.set(1, 1, p.distanceTo(q));
    });
    this.mat.opacity = this.hot ? 0.55 + Math.sin(t * 4) * 0.15 : 0.28;
    this.dots.forEach((d, i) => {
      d.visible = this.hot;
      if (this.hot) curve.getPoint(((t * 0.45 + i / this.dots.length) % 1), d.position);
    });
  }

  dispose() { this.mat.dispose(); }
}

export class WorkflowLayer {
  readonly group = new THREE.Group();
  private readonly badges = new Map<string, Badge>();
  private readonly links = new Map<string, Link>();
  private readonly activeUnits = new Set<string>();

  /** Rebuild badges and links from state (team workflows and their running runs). */
  sync(s: State) {
    const wantBadges = new Map<string, { role: string; color: string }>();
    const wantLinks = new Map<string, { from: string; to: string; on: string; color: string; hot: boolean }>();
    this.activeUnits.clear();
    for (const team of s.teams) {
      const wf = team.workflow;
      if (!wf) continue;
      const unitOf = new Map(wf.nodes.map((n) => [n.id, n.unitId]));
      for (const n of wf.nodes) {
        if (!wantBadges.has(n.unitId)) wantBadges.set(n.unitId, { role: n.role, color: team.color });
      }
      const run = latestRunning(s.workflowRuns, team.id);
      if (!run) continue;
      const active = new Set(run.active);
      for (const id of run.active) {
        const u = unitOf.get(id);
        if (u) this.activeUnits.add(u);
      }
      for (const e of wf.edges) {
        const from = unitOf.get(e.from), to = unitOf.get(e.to);
        if (!from || !to || from === to) continue;
        wantLinks.set(`${team.id}:${e.from}>${e.to}:${e.on}`, { from, to, on: e.on, color: team.color, hot: active.has(e.from) });
      }
    }

    for (const [id, b] of this.badges) {
      const w = wantBadges.get(id);
      if (!w || w.role !== b.role) { this.group.remove(b.group); b.dispose(); this.badges.delete(id); }
    }
    for (const [id, w] of wantBadges) {
      let b = this.badges.get(id);
      if (!b) { b = new Badge(w.role, w.color); this.badges.set(id, b); this.group.add(b.group); }
      b.glow.material.color.set(w.color);
      b.active = this.activeUnits.has(id);
    }

    for (const [key, l] of this.links) {
      const w = wantLinks.get(key);
      if (!w || w.from !== l.fromUnit || w.to !== l.toUnit) { this.group.remove(l.group); l.dispose(); this.links.delete(key); }
    }
    for (const [key, w] of wantLinks) {
      let l = this.links.get(key);
      if (!l) { l = new Link(w.from, w.to, w.on, w.color); this.links.set(key, l); this.group.add(l.group); }
      l.hot = w.hot;
    }
  }

  tick(t: number, units: Map<string, UnitView>) {
    for (const [id, b] of this.badges) {
      const u = units.get(id);
      b.group.visible = !!u;
      if (!u) continue;
      b.group.position.copy(u.group.position).add(BADGE_OFF);
      const k = b.active ? 1 + Math.sin(t * 5) * 0.12 : 1;
      b.sprite.scale.setScalar(0.38 * k);
      b.glow.visible = b.active;
      if (b.active) b.glow.scale.setScalar(0.85 + Math.sin(t * 5) * 0.12);
    }
    const a = new THREE.Vector3(), c = new THREE.Vector3();
    for (const l of this.links.values()) {
      const u = units.get(l.fromUnit), v = units.get(l.toUnit);
      l.group.visible = !!(u && v);
      if (!u || !v) continue;
      a.copy(u.group.position).setY(0.6);
      c.copy(v.group.position).setY(0.6);
      l.update(a, c, t);
    }
  }

  /** Units whose node is active in a running run (the scene rings them). */
  isActive(unitId: string) { return this.activeUnits.has(unitId); }
}

function latestRunning(runs: WorkflowRun[], teamId: number) {
  for (let i = runs.length - 1; i >= 0; i--) if (runs[i].teamId === teamId && runs[i].status === "running") return runs[i];
  return undefined;
}
