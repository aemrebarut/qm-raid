// Transient effects: recall beams, flying pages and orbs, bursts, floating text, and a small particle system (sparks).
// Every effect owns its objects and removes them when done; tick(dt) advances everything.
import * as THREE from "three";
import { makeLabel } from "./util";

type Pt = THREE.Vector3 | (() => THREE.Vector3);
const at = (p: Pt) => (typeof p === "function" ? p() : p);

interface Effect { t: number; dur: number; update(k: number, dt: number): void; done(): void }

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let pageTex: THREE.Texture | null = null;
function pageTexture() {
  if (pageTex) return pageTex;
  const c = document.createElement("canvas");
  c.width = 48; c.height = 60;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4e7c4";
  ctx.strokeStyle = "#2f6fb8";
  ctx.lineWidth = 4;
  ctx.fillRect(4, 4, 40, 52);
  ctx.strokeRect(4, 4, 40, 52);
  ctx.fillStyle = "#7a6440";
  for (let i = 0; i < 5; i++) ctx.fillRect(10, 14 + i * 8, i === 4 ? 16 : 28, 3);
  pageTex = new THREE.CanvasTexture(c);
  pageTex.colorSpace = THREE.SRGBColorSpace;
  return pageTex;
}

let scrollTex: THREE.Texture | null = null;
function scrollTexture() {
  if (scrollTex) return scrollTex;
  const c = document.createElement("canvas");
  c.width = 72; c.height = 56;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f1e1b4";
  ctx.strokeStyle = "#6b4e2a";
  ctx.lineWidth = 3;
  ctx.fillRect(12, 10, 48, 36);
  ctx.strokeRect(12, 10, 48, 36);
  // Rolled ends
  for (const x of [8, 64]) {
    ctx.fillStyle = "#d9c08a";
    ctx.beginPath();
    ctx.ellipse(x, 28, 7, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = "#7a6440";
  for (let i = 0; i < 3; i++) ctx.fillRect(20, 18 + i * 8, i === 2 ? 20 : 32, 3);
  // Wax seal
  ctx.fillStyle = "#b3261e";
  ctx.beginPath();
  ctx.arc(50, 40, 6, 0, Math.PI * 2);
  ctx.fill();
  scrollTex = new THREE.CanvasTexture(c);
  scrollTex.colorSpace = THREE.SRGBColorSpace;
  return scrollTex;
}

function glowSprite(color: THREE.ColorRepresentation, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  s.renderOrder = 5;
  return s;
}

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
const UP = new THREE.Vector3(0, 1, 0);

export class Fx {
  readonly group = new THREE.Group();
  private effects: Effect[] = [];
  private readonly sparks: Sparks;

  constructor() {
    this.group.name = "fx";
    this.sparks = new Sparks(400);
    this.group.add(this.sparks.points);
  }

  private add(e: Effect) { this.effects.push(e); }

  tick(dt: number) {
    const keep: Effect[] = [];
    for (const e of this.effects) {
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.update(k, dt);
      if (k >= 1) e.done(); else keep.push(e);
    }
    this.effects = keep;
    this.sparks.tick(dt);
  }

  /** Glowing beam between two (possibly moving) points. */
  beam(from: Pt, to: Pt, color: THREE.ColorRepresentation, dur = 1.8, width = 0.09) {
    const outer = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    const inner = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    const endGlow = glowSprite(color, 0.9);
    const g = new THREE.Group();
    g.add(outer, inner, endGlow);
    g.renderOrder = 4;
    this.group.add(g);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
    this.add({
      t: 0, dur,
      update: (k) => {
        a.copy(at(from)); b.copy(at(to));
        // Grow from the source during the first 20%, fade out in the last 30%.
        const grow = Math.min(1, k / 0.2);
        const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        b.lerpVectors(a, b, grow);
        dir.subVectors(b, a);
        const len = Math.max(0.001, dir.length());
        mid.addVectors(a, b).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
        const wob = 1 + Math.sin(k * 40) * 0.15;
        for (const [m, w] of [[outer, width * 1.8 * wob], [inner, width * 0.45]] as const) {
          m.position.copy(mid);
          m.quaternion.copy(q);
          m.scale.set(w * fade, len, w * fade);
        }
        (outer.material as THREE.MeshBasicMaterial).opacity = 0.4 * fade;
        (inner.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;
        endGlow.position.copy(b);
        endGlow.material.opacity = fade;
      },
      done: () => {
        this.group.remove(g);
        outer.material.dispose(); inner.material.dispose(); endGlow.material.dispose();
      },
    });
  }

  /** A sprite or mesh flying along an arc from a to b; b may move (a walking unit). */
  fly(obj: THREE.Object3D, from: Pt, to: Pt, dur: number, arc: number, onArrive?: () => void, trail?: THREE.ColorRepresentation) {
    this.group.add(obj);
    const a0 = at(from).clone();
    const p = new THREE.Vector3();
    let trailAcc = 0;
    this.add({
      t: 0, dur,
      update: (k, dt) => {
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
        p.lerpVectors(a0, at(to), e);
        p.y += Math.sin(Math.PI * e) * arc;
        obj.position.copy(p);
        if (obj instanceof THREE.Sprite) obj.material.rotation = Math.sin(k * 12) * 0.3;
        if (trail) {
          trailAcc += dt;
          if (trailAcc > 0.02) { trailAcc = 0; this.sparks.emit(p, 2, { color: trail, speed: 0.3, life: 0.45, gravity: -0.2 }); }
        }
      },
      done: () => {
        this.group.remove(obj);
        if (obj instanceof THREE.Sprite) obj.material.dispose();
        onArrive?.();
      },
    });
  }

  /** Blue page icon flying from the Library to a unit. */
  page(from: Pt, to: Pt, delay = 0, onArrive?: () => void) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pageTexture(), transparent: true, depthTest: false }));
    s.scale.set(0.34, 0.42, 1);
    s.renderOrder = 12;
    s.visible = false;
    this.after(delay, () => { s.visible = true; this.fly(s, from, to, 1.1, 1.6, onArrive, "#6fb6ff"); });
  }

  /** Gold orb flying from a unit into the Library. */
  orb(from: Pt, to: Pt, onArrive?: () => void) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: "#ffd45a" })));
    g.add(glowSprite("#ffb82e", 0.8));
    g.renderOrder = 12;
    this.fly(g, from, to, 1.5, 2.2, () => {
      (g.children[0] as THREE.Mesh).geometry.dispose();
      onArrive?.();
    }, "#ffc94a");
  }

  /** Rolled scroll flying in an arc from unit to unit (workflow handoff), glowing in the team colour. */
  scroll(from: Pt, to: Pt, opts: { color?: THREE.ColorRepresentation; dur?: number } = {}, onArrive?: () => void) {
    const color = opts.color ?? "#ffd45a";
    const g = new THREE.Group();
    const glow = glowSprite(color, 1.1);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: scrollTexture(), transparent: true, depthTest: false }));
    s.scale.set(0.66, 0.51, 1);
    s.renderOrder = 12;
    glow.renderOrder = 11;
    glow.material.depthTest = false;
    g.add(glow, s);
    const dur = opts.dur ?? 1.4;
    const dist = at(from).distanceTo(at(to));
    this.fly(g, from, to, dur, 1.2 + dist * 0.12, () => {
      s.material.dispose();
      glow.material.dispose();
      onArrive?.();
    }, color);
    // Tumble the scroll a little in flight
    this.add({ t: 0, dur, update: (k) => { s.material.rotation = Math.sin(k * Math.PI * 3) * 0.35; }, done: () => {} });
  }

  /** Expanding flat ring and glow at a point. */
  burst(p: THREE.Vector3, color: THREE.ColorRepresentation, size = 1.2, dur = 0.8) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    const glow = glowSprite(color, size);
    const g = new THREE.Group();
    g.add(ring, glow);
    g.position.copy(p);
    this.group.add(g);
    this.sparks.emit(p, 14, { color, speed: 1.6, life: 0.6, gravity: 1.5 });
    this.add({
      t: 0, dur,
      update: (k) => {
        ring.scale.setScalar(0.1 + k * size);
        (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        glow.material.opacity = 1 - k;
        glow.scale.setScalar(size * (0.6 + k * 0.8));
      },
      done: () => { this.group.remove(g); ring.geometry.dispose(); (ring.material as THREE.Material).dispose(); glow.material.dispose(); },
    });
  }

  /** Floating label that rises and fades (e.g. the recalled slug, "+1 page"). */
  text(p: Pt, text: string, opts: { color?: string; bg?: string | null; height?: number; dur?: number } = {}) {
    const l = makeLabel(text, { height: opts.height ?? 0.3, color: opts.color, bg: opts.bg, font: 36 });
    l.renderOrder = 13;
    this.group.add(l);
    const base = new THREE.Vector3();
    this.add({
      t: 0, dur: opts.dur ?? 2.4,
      update: (k) => {
        base.copy(at(p));
        l.position.set(base.x, base.y + k * 0.7, base.z);
        l.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      },
      done: () => { this.group.remove(l); l.material.map?.dispose(); l.material.dispose(); },
    });
  }

  sparksAt(p: THREE.Vector3, n = 8, color: THREE.ColorRepresentation = "#ffb347") {
    this.sparks.emit(p, n, { color, speed: 1.8, life: 0.45, gravity: 5, up: 1.2 });
  }

  after(delay: number, fn: () => void) {
    if (delay <= 0) return fn();
    this.add({ t: 0, dur: delay, update: () => {}, done: fn });
  }
}

/** Additive point particles with velocity, gravity and colour fading to black. */
class Sparks {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly base: Float32Array;
  private readonly grav: Float32Array;
  private next = 0;

  constructor(private readonly n: number) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 9, sizeAttenuation: false, map: glowTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  emit(p: THREE.Vector3, count: number, o: { color: THREE.ColorRepresentation; speed: number; life: number; gravity: number; up?: number }) {
    const c = new THREE.Color(o.color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2, s = o.speed * (0.4 + Math.random() * 0.6);
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([Math.cos(a) * s, (o.up ?? 0.5) * s * (0.5 + Math.random()), Math.sin(a) * s], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.max[i] = o.life * (0.6 + Math.random() * 0.4);
      this.grav[i] = o.gravity;
    }
  }

  tick(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}
