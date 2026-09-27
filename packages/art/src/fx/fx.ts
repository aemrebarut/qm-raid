// ArtFx: every transient effect of the board in one object with one tick(dt).
// Drop-in superset of the board's scene/fx.ts Fx (same beam/fly/page/orb/burst/text/sparksAt/after signatures),
// plus the art effects: recallBeam, rememberOrb, orderPing, dust, flag, forgeSparks, smoke, sparkle, handoffScroll,
// and a self-animating SelectionRing. Budget: two particle pools (one draw call each), a handful of meshes per effect.
import * as THREE from "three";
import { GlowPool, PuffPool } from "./particles";
import {
  bannerTexture, chevronTexture, dashedRingTexture, glowTexture, pageTexture, runeAtlas, runeCircleTexture, softRingTexture,
} from "./textures";

export type Pt = THREE.Vector3 | (() => THREE.Vector3);
const at = (p: Pt) => (typeof p === "function" ? p() : p);

interface Effect { t: number; dur: number; update(k: number, dt: number): void; done(): void }

export const FX_COLORS = {
  recall: "#4aa3ff",
  recallCore: "#dff0ff",
  remember: "#ffc94a",
  rememberCore: "#fff3c4",
  approve: "#7ee06a",
  changes: "#ff6a4a",
  forge: "#ff9a3c",
  dust: "#b9a47c",
  smoke: "#8d8781",
};

const UP = new THREE.Vector3(0, 1, 0);
const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

// ---- shared geometry (created lazily so importing never touches WebGL) ----
let _beamGeo: THREE.CylinderGeometry | null = null;
const beamGeo = () => (_beamGeo ??= new THREE.CylinderGeometry(1, 1, 1, 12, 1, true));
let _flatGeo: THREE.PlaneGeometry | null = null;
const flatGeo = () => (_flatGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
let _orbGeo: THREE.IcosahedronGeometry | null = null;
const orbGeo = () => (_orbGeo ??= new THREE.IcosahedronGeometry(0.1, 1));

function additive(color: THREE.ColorRepresentation, map?: THREE.Texture, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    color, ...(map ? { map } : {}), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: false,
  });
}

function glowSprite(color: THREE.ColorRepresentation, size: number, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  s.scale.setScalar(size);
  s.renderOrder = 7;
  return s;
}

/** Scrolling energy streaks along a beam (v runs along the beam). */
let _streakTex: THREE.CanvasTexture | null = null;
function streakTexture() {
  if (_streakTex) return _streakTex;
  const c = document.createElement("canvas");
  c.width = 8; c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  for (let i = 0; i <= 8; i++) {
    const y = i / 8;
    g.addColorStop(y, i % 2 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,1)");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  _streakTex = new THREE.CanvasTexture(c);
  _streakTex.wrapS = _streakTex.wrapT = THREE.RepeatWrapping;
  return _streakTex;
}

/** Eight rune glyph textures sharing one atlas image. */
const runeTexes: THREE.Texture[] = [];
function runeTex(i: number) {
  if (!runeTexes.length) {
    const atlas = runeAtlas();
    for (let k = 0; k < 8; k++) {
      const t = atlas.clone();
      t.repeat.set(0.25, 0.5);
      t.offset.set((k % 4) * 0.25, k < 4 ? 0.5 : 0);
      t.needsUpdate = true;
      runeTexes.push(t);
    }
  }
  return runeTexes[i % 8];
}

export interface LabelOpts { height?: number; color?: string; bg?: string | null; font?: number }

/** Text sprite anchored at its bottom centre, drawn on top (parchment chip, or outlined text with bg: null). */
export function makeLabel(text: string, o: LabelOpts = {}) {
  const font = o.font ?? 36;
  const pad = Math.round(font * 0.45);
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const fontStr = `600 ${font}px ${SERIF}`;
  ctx.font = fontStr;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.ceil(font * 1.35) + pad;
  c.width = w; c.height = h;
  ctx.font = fontStr;
  if (o.bg !== null) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, o.bg ?? "#f1e3bf");
    g.addColorStop(1, o.bg ?? "#d9c393");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 8);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#6b4e2a";
    ctx.stroke();
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (o.bg === null) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(text, w / 2, h / 2 + 1);
  }
  ctx.fillStyle = o.color ?? "#2b1d0e";
  ctx.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
  const hh = o.height ?? 0.3;
  sp.scale.set((hh * w) / h, hh, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 13;
  return sp;
}

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const easeOutBack = (k: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };

export class ArtFx {
  readonly group = new THREE.Group();
  readonly glow: GlowPool;
  readonly puff: PuffPool;
  private effects: Effect[] = [];
  private readonly tmp = new THREE.Vector3();

  constructor(opts: { glowBudget?: number; puffBudget?: number } = {}) {
    this.group.name = "art:fx";
    this.glow = new GlowPool(opts.glowBudget ?? 700);
    this.puff = new PuffPool(opts.puffBudget ?? 320);
    this.group.add(this.puff.points, this.glow.points);
  }

  private add(e: Effect) { this.effects.push(e); }

  /** Number of running effects (for the fps overlay and tests). */
  get active() { return this.effects.length; }

  tick(dt: number) {
    const keep: Effect[] = [];
    // for..of also visits effects pushed by done() callbacks during this loop (an orb landing starts a burst).
    for (const e of this.effects) {
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.update(k, dt);
      if (k >= 1) e.done(); else keep.push(e);
    }
    this.effects = keep;
    this.puff.tick(dt);
    this.glow.tick(dt);
  }

  after(delay: number, fn: () => void) {
    if (delay <= 0) return fn();
    this.add({ t: 0, dur: delay, update: () => {}, done: fn });
  }

  // =====================================================================================
  // Board-compatible primitives
  // =====================================================================================

  /** Glowing beam between two (possibly moving) points, with streaks flowing from `from` to `to`. */
  beam(from: Pt, to: Pt, color: THREE.ColorRepresentation, dur = 1.8, width = 0.09) {
    const streak = streakTexture().clone();
    streak.needsUpdate = true;
    const outer = new THREE.Mesh(beamGeo(), additive(color, streak, 0.5));
    const inner = new THREE.Mesh(beamGeo(), additive("#ffffff", undefined, 0.85));
    const endGlow = glowSprite(color, 0.9);
    const startGlow = glowSprite(color, 1.2, 0.8);
    const g = new THREE.Group();
    g.add(outer, inner, endGlow, startGlow);
    outer.renderOrder = inner.renderOrder = 5;
    this.group.add(g);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion();
    this.add({
      t: 0, dur,
      update: (k, dt) => {
        a.copy(at(from)); b.copy(at(to));
        const grow = easeOut(Math.min(1, k / 0.18));
        const fade = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        b.lerpVectors(a, b, grow);
        dir.subVectors(b, a);
        const len = Math.max(0.001, dir.length());
        mid.addVectors(a, b).multiplyScalar(0.5);
        q.setFromUnitVectors(UP, dir.normalize());
        const wob = 1 + Math.sin(k * 50) * 0.12;
        for (const [m, w] of [[outer, width * 2 * wob], [inner, width * 0.42]] as const) {
          m.position.copy(mid);
          m.quaternion.copy(q);
          m.scale.set(w * fade, len, w * fade);
        }
        streak.repeat.set(1, len * 0.8);
        streak.offset.y += dt * 2.5; // cylinder v runs bottom to top; beam points from a to b, so flow toward b
        (outer.material as THREE.MeshBasicMaterial).opacity = 0.55 * fade;
        (inner.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
        endGlow.position.copy(b);
        endGlow.material.opacity = fade;
        endGlow.scale.setScalar(0.8 + Math.sin(k * 30) * 0.1);
        startGlow.position.copy(a);
        startGlow.material.opacity = 0.8 * fade;
      },
      done: () => {
        this.group.remove(g);
        streak.dispose();
        (outer.material as THREE.Material).dispose(); (inner.material as THREE.Material).dispose();
        endGlow.material.dispose(); startGlow.material.dispose();
      },
    });
  }

  /** An object flying along an arc from a to b; b may move (a walking unit). Trail of glow motes. */
  fly(obj: THREE.Object3D, from: Pt, to: Pt, dur: number, arc: number, onArrive?: () => void, trail?: THREE.ColorRepresentation, spin = 0) {
    this.group.add(obj);
    const a0 = at(from).clone();
    const p = new THREE.Vector3(), prev = new THREE.Vector3().copy(a0), vel = new THREE.Vector3();
    let trailAcc = 0;
    this.add({
      t: 0, dur,
      update: (k, dt) => {
        const e = easeInOut(k);
        p.lerpVectors(a0, at(to), e);
        p.y += Math.sin(Math.PI * e) * arc;
        obj.position.copy(p);
        if (obj instanceof THREE.Sprite) obj.material.rotation = Math.sin(k * 12) * 0.3;
        else if (spin) obj.rotation.y += spin * dt;
        if (trail) {
          trailAcc += dt;
          vel.subVectors(p, prev).multiplyScalar(-0.15 / Math.max(dt, 1e-3));
          while (trailAcc > 0.016) {
            trailAcc -= 0.016;
            this.glow.emitAt(p, vel, { color: trail, speed: 0, life: 0.45, size: 0.14, grow: 0.3, gravity: -0.1 });
          }
        }
        prev.copy(p);
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
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pageTexture(), transparent: true, depthTest: false, toneMapped: false }));
    s.scale.set(0.34, 0.42, 1);
    s.renderOrder = 12;
    this.after(delay, () => this.fly(s, from, to, 1.1, 1.6, onArrive, "#6fb6ff"));
  }

  /** Gold orb flying from a unit into the Library (board signature). Same visual as rememberOrb. */
  orb(from: Pt, to: Pt, onArrive?: () => void) { this.rememberOrb(from, to, onArrive); }

  /** Expanding soft ring on the ground plus glow and sparks at a point. */
  burst(p: THREE.Vector3, color: THREE.ColorRepresentation, size = 1.2, dur = 0.8) {
    const ring = new THREE.Mesh(flatGeo(), additive(color, softRingTexture()));
    ring.renderOrder = 4;
    const glow = glowSprite(color, size);
    const g = new THREE.Group();
    g.add(ring, glow);
    g.position.copy(p);
    this.group.add(g);
    this.glow.emit(p, 14, { color, speed: 1.6, life: 0.6, gravity: 2.5, up: 1, size: 0.1 });
    this.add({
      t: 0, dur,
      update: (k) => {
        const e = easeOut(k);
        ring.scale.setScalar(0.2 + e * size * 1.6);
        (ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
        glow.material.opacity = (1 - k) * 0.9;
        glow.scale.setScalar(size * (0.6 + e * 0.6));
      },
      done: () => { this.group.remove(g); (ring.material as THREE.Material).dispose(); glow.material.dispose(); },
    });
  }

  /** Floating label that rises and fades (the recalled slug, "+1 page"). */
  text(p: Pt, text: string, opts: { color?: string; bg?: string | null; height?: number; dur?: number } = {}) {
    const l = makeLabel(text, { height: opts.height ?? 0.3, color: opts.color, bg: opts.bg });
    const aspect = l.scale.x / l.scale.y;
    this.group.add(l);
    const base = new THREE.Vector3();
    this.add({
      t: 0, dur: opts.dur ?? 2.4,
      update: (k) => {
        base.copy(at(p));
        const pop = k < 0.08 ? easeOutBack(k / 0.08) : 1;
        l.position.set(base.x, base.y + easeOut(k) * 0.7, base.z);
        l.material.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
        l.scale.y = (opts.height ?? 0.3) * pop;
        l.scale.x = aspect * l.scale.y;
      },
      done: () => { this.group.remove(l); l.material.map?.dispose(); l.material.dispose(); },
    });
  }

  sparksAt(p: THREE.Vector3, n = 8, color: THREE.ColorRepresentation = "#ffb347") {
    this.glow.emit(p, n, { color, speed: 1.8, life: 0.45, gravity: 5, up: 1.2, size: 0.08 });
  }

  // =====================================================================================
  // Art effects
  // =====================================================================================

  /**
   * GBrain recall: blue beam from the Library (from) to the unit's staff tip (to), a rune circle turning on the
   * ground under the unit, glyphs spiralling up around it and motes streaming down the beam.
   * ground: world y of the unit's feet (default 0).
   */
  recallBeam(from: Pt, to: Pt, opts: { dur?: number; color?: THREE.ColorRepresentation; ground?: number } = {}) {
    const dur = opts.dur ?? 2.4;
    const color = opts.color ?? FX_COLORS.recall;
    this.beam(from, to, color, dur, 0.13);

    const circle = new THREE.Mesh(flatGeo(), additive(color, runeCircleTexture()));
    circle.renderOrder = 4;
    const glyphs: THREE.Sprite[] = [];
    const g = new THREE.Group();
    g.add(circle);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: runeTex(i), color: i % 2 ? FX_COLORS.recallCore : color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      s.scale.setScalar(0.2);
      s.renderOrder = 8;
      glyphs.push(s);
      g.add(s);
    }
    this.group.add(g);
    const ground = opts.ground ?? 0;
    const base = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
    let moteAcc = 0;
    this.add({
      t: 0, dur,
      update: (k, dt) => {
        base.copy(at(to)).setY(ground + 0.03);
        g.position.copy(base);
        const inK = easeOutBack(Math.min(1, k / 0.25));
        const fade = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        circle.scale.setScalar(0.95 * inK);
        circle.rotation.y = k * 2.2;
        (circle.material as THREE.MeshBasicMaterial).opacity = 0.85 * fade;
        glyphs.forEach((s, i) => {
          const ph = (k * 1.6 + i / glyphs.length) % 1; // each glyph loops bottom to top
          const ang = i * (Math.PI * 2 / glyphs.length) + k * 7;
          const r = 0.42 * (1 - ph * 0.55);
          s.position.set(Math.cos(ang) * r, 0.1 + ph * 1.1, Math.sin(ang) * r);
          s.material.opacity = Math.sin(Math.PI * ph) * fade;
          s.scale.setScalar(0.16 + 0.08 * Math.sin(Math.PI * ph));
        });
        // Motes streaming down the beam toward the unit
        moteAcc += dt;
        if (k > 0.15 && k < 0.8) {
          a.copy(at(from)); b.copy(at(to));
          dir.subVectors(b, a);
          while (moteAcc > 0.03) {
            moteAcc -= 0.03;
            const u = Math.random();
            this.tmp.copy(a).addScaledVector(dir, u);
            this.tmp.x += (Math.random() - 0.5) * 0.15;
            this.tmp.z += (Math.random() - 0.5) * 0.15;
            this.glow.emitAt(this.tmp, dir.clone().multiplyScalar(0.5), { color: FX_COLORS.recallCore, speed: 0, life: 0.5, size: 0.07 });
          }
        } else moteAcc = 0;
      },
      done: () => {
        this.group.remove(g);
        (circle.material as THREE.Material).dispose();
        glyphs.forEach((s) => s.material.dispose());
      },
    });
    // Flash at the unit when the beam lands
    this.after(0.4, () => {
      const p = at(to).clone();
      this.glow.emit(p, 16, { color: FX_COLORS.recallCore, speed: 1.2, life: 0.6, gravity: -0.5, up: 0.6, size: 0.09 });
    });
  }

  /**
   * GBrain remember: a gold orb with a comet tail arcs from the unit (from) into the Library (to).
   * On arrival: a rising ring pulse and a gold burst at the Library, then onArrive (the caller pulses the building).
   */
  rememberOrb(from: Pt, to: Pt, onArrive?: () => void, opts: { dur?: number } = {}) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(orbGeo(), new THREE.MeshBasicMaterial({ color: FX_COLORS.rememberCore, toneMapped: false }));
    const halo = glowSprite(FX_COLORS.remember, 0.9);
    const orbiters = [glowSprite("#fff0b0", 0.22), glowSprite("#ffb82e", 0.18)];
    g.add(core, halo, ...orbiters);
    g.renderOrder = 12;
    let t = 0;
    const tickOrb = () => {
      t += 1 / 60;
      halo.scale.setScalar(0.85 + Math.sin(t * 18) * 0.12);
      orbiters.forEach((o, i) => {
        const a = t * 9 + i * Math.PI;
        o.position.set(Math.cos(a) * 0.2, Math.sin(a * 1.3) * 0.08, Math.sin(a) * 0.2);
      });
    };
    core.onBeforeRender = tickOrb;
    const src = at(from).clone();
    this.burst(src.clone(), FX_COLORS.remember, 0.6, 0.5);
    this.fly(g, from, to, opts.dur ?? 1.5, 2.2, () => {
      (core.material as THREE.Material).dispose();
      halo.material.dispose();
      orbiters.forEach((o) => o.material.dispose());
      const p = at(to).clone();
      this.pulseAt(p, FX_COLORS.remember);
      this.burst(p, "#ffd45a", 2.0, 1.0);
      this.glow.emit(p, 26, { color: "#ffe28a", speed: 2.2, life: 0.9, gravity: 1.2, up: 0.9, size: 0.1 });
      onArrive?.();
    }, FX_COLORS.remember);
  }

  /** Vertical ring that rises and widens around a point (building pulse, level-up feel). */
  pulseAt(p: THREE.Vector3, color: THREE.ColorRepresentation, size = 1.6, dur = 0.9) {
    const rings = [0, 1].map(() => {
      const m = new THREE.Mesh(flatGeo(), additive(color, softRingTexture()));
      m.renderOrder = 6;
      this.group.add(m);
      return m;
    });
    this.add({
      t: 0, dur,
      update: (k) => {
        rings.forEach((m, i) => {
          const kk = Math.max(0, k * 1.3 - i * 0.3);
          const e = easeOut(Math.min(1, kk));
          m.position.set(p.x, p.y - 0.4 + e * 0.8, p.z);
          m.scale.setScalar(0.3 + e * size);
          (m.material as THREE.MeshBasicMaterial).opacity = kk <= 0 ? 0 : (1 - Math.min(1, kk)) * 0.9;
        });
      },
      done: () => rings.forEach((m) => { this.group.remove(m); (m.material as THREE.Material).dispose(); }),
    });
  }

  /**
   * Order confirmation at a target: a ring contracts onto the point, a chevron drops in twice, a flash on landing.
   * color: team colour of the ordering units (green default); pass "#ff5a4a" for an invalid order.
   */
  orderPing(p: THREE.Vector3, color: THREE.ColorRepresentation = "#8dff6a", size = 1) {
    const ring = new THREE.Mesh(flatGeo(), additive(color, softRingTexture()));
    ring.renderOrder = 4;
    const dashes = new THREE.Mesh(flatGeo(), additive(color, dashedRingTexture()));
    dashes.renderOrder = 4;
    const chev = new THREE.Sprite(new THREE.SpriteMaterial({ map: chevronTexture(), color, transparent: true, depthTest: false, toneMapped: false }));
    chev.scale.setScalar(0.32 * size);
    chev.center.set(0.5, 0);
    chev.renderOrder = 12;
    const g = new THREE.Group();
    g.add(ring, dashes, chev);
    g.position.copy(p).setY(p.y + 0.03);
    this.group.add(g);
    let landed = 0;
    this.add({
      t: 0, dur: 0.9,
      update: (k) => {
        ring.scale.setScalar(size * (1.9 - easeOut(Math.min(1, k / 0.45)) * 1.4));
        (ring.material as THREE.MeshBasicMaterial).opacity = k < 0.45 ? k / 0.45 : 1 - (k - 0.45) / 0.55;
        dashes.scale.setScalar(size * 0.8);
        dashes.rotation.y = -k * 3;
        (dashes.material as THREE.MeshBasicMaterial).opacity = k < 0.3 ? 0 : 1 - (k - 0.3) / 0.7;
        // Two bounces of the chevron: fall from 1.0 to 0.25, bounce to 0.5, settle, fade
        const bounce = k < 0.3 ? 1 - easeInOut(k / 0.3) : k < 0.55 ? Math.sin(((k - 0.3) / 0.25) * Math.PI) * 0.3 : 0;
        chev.position.y = 0.25 + bounce * 0.75;
        chev.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        if (k >= 0.3 && !landed) {
          landed = 1;
          this.glow.emit(g.position, 10, { color, speed: 1.4, life: 0.4, gravity: 2, up: 0.5, size: 0.08 });
        }
      },
      done: () => {
        this.group.remove(g);
        (ring.material as THREE.Material).dispose(); (dashes.material as THREE.Material).dispose(); chev.material.dispose();
      },
    });
  }

  /** A few dust puffs at a walking unit's feet; call every ~0.25 s while moving. */
  dust(p: THREE.Vector3, n = 2, color: THREE.ColorRepresentation = FX_COLORS.dust) {
    this.puff.emit(this.tmp.copy(p).setY(p.y + 0.04), n, {
      color, speed: 0.35, up: 0.5, gravity: -0.08, life: 0.8, size: 0.16, grow: 2.4, drag: 2.5, spread: 0.08,
    });
  }

  /** Chimney or furnace smoke: one soft grey puff drifting up; call every ~0.2 s. */
  smoke(p: THREE.Vector3, color: THREE.ColorRepresentation = FX_COLORS.smoke, n = 1) {
    this.puff.emit(p, n, { color, speed: 0.12, up: 1, gravity: -0.35, life: 2.6, size: 0.22, grow: 3.2, drag: 0.6, spread: 0.05 });
  }

  /** Forge sparks: an anvil strike (hot sparks with gravity) plus a couple of embers that float up. */
  forgeSparks(p: THREE.Vector3, intensity = 1) {
    this.glow.emit(p, Math.round(10 * intensity), { color: "#ffc766", speed: 2.2, life: 0.5, gravity: 7, up: 1.5, size: 0.07 });
    this.glow.emit(p, Math.round(4 * intensity), { color: FX_COLORS.forge, speed: 1.6, life: 0.7, gravity: 5, up: 1.2, size: 0.09 });
    this.glow.emit(p, Math.max(1, Math.round(2 * intensity)), { color: "#ff7a2a", speed: 0.25, life: 1.8, gravity: -0.35, up: 1, size: 0.06, spread: 0.1 });
  }

  /** Twinkling motes (new unit, level up, a page landing). */
  sparkle(p: THREE.Vector3, color: THREE.ColorRepresentation = "#fff2b0", n = 12) {
    this.glow.emit(p, n, { color, speed: 0.7, life: 0.9, gravity: -0.3, up: 1, size: 0.1, spread: 0.25, grow: 0.2 });
  }

  /**
   * Victory flag planted at a point (issue resolved): a pole with a team banner springs up, the cloth waves,
   * gold sparkles at the base. Stays for dur seconds (Infinity keeps it) and sinks back. Returns remove().
   */
  flag(p: THREE.Vector3, color: string = "#c0392b", opts: { dur?: number; height?: number } = {}) {
    const h = opts.height ?? 1.1;
    const g = new THREE.Group();
    g.position.copy(p);
    const woodM = new THREE.MeshLambertMaterial({ color: "#6b4a2b" });
    const goldM = new THREE.MeshLambertMaterial({ color: "#e9c25a", emissive: new THREE.Color("#5a3d00") });
    const poleGeo = new THREE.CylinderGeometry(0.022, 0.028, h, 6).translate(0, h / 2, 0);
    const pole = new THREE.Mesh(poleGeo, woodM);
    pole.castShadow = true;
    const knobGeo = new THREE.IcosahedronGeometry(0.05, 0);
    const knob = new THREE.Mesh(knobGeo, goldM);
    knob.position.y = h + 0.03;
    const clothGeo = new THREE.PlaneGeometry(0.46, 0.32, 10, 4).translate(0.23, 0, 0);
    const clothM = new THREE.MeshLambertMaterial({ map: bannerTexture(color), side: THREE.DoubleSide });
    const cloth = new THREE.Mesh(clothGeo, clothM);
    cloth.position.y = h - 0.2;
    cloth.castShadow = true;
    const moundGeo = new THREE.CylinderGeometry(0.12, 0.17, 0.06, 7);
    const mound = new THREE.Mesh(moundGeo, new THREE.MeshLambertMaterial({ color: "#7a6446" }));
    mound.position.y = 0.03;
    mound.receiveShadow = true;
    const rise = new THREE.Group();
    rise.add(pole, knob, cloth);
    g.add(mound, rise);
    this.group.add(g);
    const base = clothGeo.attributes.position.array.slice() as Float32Array;
    const pos = clothGeo.attributes.position as THREE.BufferAttribute;
    const dur = opts.dur ?? 8;
    let t = 0, removing = -1, dead = false;
    this.pulseAt(p.clone().setY(p.y + 0.4), "#ffd45a", 1.2, 0.8);
    this.sparkle(p.clone().setY(p.y + 0.2), "#ffe9a0", 18);
    const cleanup = () => {
      if (dead) return;
      dead = true;
      eff.dur = 0; // ends the effect on the next tick, also for dur: Infinity
      this.group.remove(g);
      [poleGeo, knobGeo, clothGeo, moundGeo].forEach((x) => x.dispose());
      [woodM, goldM, clothM, mound.material as THREE.Material].forEach((m) => m.dispose());
    };
    const eff: Effect = {
      t: 0, dur: Number.isFinite(dur) ? dur + 0.6 : 1e9,
      update: (_k, dt) => {
        if (dead) return;
        t += dt;
        const up = t < 0.5 ? easeOutBack(t / 0.5) : 1;
        const down = removing >= 0 ? Math.max(0, 1 - (t - removing) / 0.5) : Number.isFinite(dur) && t > dur ? Math.max(0, 1 - (t - dur) / 0.5) : 1;
        rise.scale.y = Math.max(0.001, up * down);
        rise.position.y = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3], y = base[i * 3 + 1];
          const w = x / 0.46; // 0 at the pole, 1 at the free edge
          pos.setZ(i, Math.sin(t * 6 - x * 9) * 0.06 * w + Math.sin(t * 3.7 + y * 5) * 0.015 * w);
          pos.setY(i, y - w * w * 0.03);
        }
        pos.needsUpdate = true;
        clothGeo.computeVertexNormals();
        if (Math.random() < dt * 3) this.sparkle(this.tmp.copy(g.position).setY(g.position.y + 0.1 + Math.random() * h), "#ffe9a0", 1);
        if (removing >= 0 && t - removing > 0.5) cleanup();
      },
      done: cleanup,
    };
    this.add(eff);
    return { object3d: g, remove: () => { if (removing < 0) removing = t; } };
  }

  /**
   * Workflow handoff: a sealed parchment scroll arcs from one unit to the next (planner -> implementer -> reviewer).
   * verdict colours the ribbon and landing burst: "approve" green, "changes" red, anything else gold.
   * label: optional floating text at the receiver ("changes requested", "plan", ...).
   */
  handoffScroll(from: Pt, to: Pt, opts: { verdict?: string; label?: string; dur?: number; onArrive?: () => void; color?: THREE.ColorRepresentation; arc?: number } = {}) {
    const ribbonColor = opts.verdict === "approve" ? FX_COLORS.approve : opts.verdict === "changes" ? FX_COLORS.changes : opts.color ?? "#e2b33c";
    const g = new THREE.Group();
    const paperGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.3, 10).rotateZ(Math.PI / 2);
    const knobGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6).rotateZ(Math.PI / 2);
    const ribbonGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateZ(Math.PI / 2);
    const sealGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8).rotateX(Math.PI / 2).translate(0, 0, 0.065);
    const paperM = new THREE.MeshBasicMaterial({ color: "#f2e3bd", toneMapped: false });
    const knobM = new THREE.MeshBasicMaterial({ color: "#7a5230", toneMapped: false });
    const ribbonM = new THREE.MeshBasicMaterial({ color: ribbonColor, toneMapped: false });
    const sealM = new THREE.MeshBasicMaterial({ color: "#a8322a", toneMapped: false });
    const scroll = new THREE.Group();
    scroll.add(new THREE.Mesh(paperGeo, paperM), new THREE.Mesh(knobGeo, knobM), new THREE.Mesh(ribbonGeo, ribbonM), new THREE.Mesh(sealGeo, sealM));
    const halo = glowSprite(ribbonColor, 0.7, 0.8);
    g.add(halo, scroll);
    g.renderOrder = 12;
    let t = 0;
    scroll.onBeforeRender = () => {}; // groups do not render; animate through the paper mesh instead
    (scroll.children[0] as THREE.Mesh).onBeforeRender = () => {
      t += 1 / 60;
      scroll.rotation.z = Math.sin(t * 5) * 0.35;
      halo.scale.setScalar(0.65 + Math.sin(t * 14) * 0.08);
    };
    const src = at(from).clone();
    this.sparkle(src, ribbonColor, 8);
    this.fly(g, from, to, opts.dur ?? 1.2, opts.arc ?? 1.3, () => {
      [paperGeo, knobGeo, ribbonGeo, sealGeo].forEach((x) => x.dispose());
      [paperM, knobM, ribbonM, sealM].forEach((m) => m.dispose());
      halo.material.dispose();
      const p = at(to).clone();
      this.burst(p, ribbonColor, 0.9, 0.6);
      if (opts.label) this.text(p.clone().setY(p.y + 0.3), opts.label, { color: "#fff6d8", bg: null, height: 0.24, dur: 2 });
      opts.onArrive?.();
    }, "#f3dca0", 3.5);
  }

  /**
   * Board signature of the handoff (raid-ui-scene, scene/fx.ts scroll): from/to are unit head points, to may move;
   * color is the team colour (ribbon, glow, landing burst). Default 1.4 s, arc 1.2 + distance * 0.12.
   */
  scroll(from: Pt, to: Pt, opts: { color?: THREE.ColorRepresentation; dur?: number } = {}, onArrive?: () => void) {
    const dist = at(from).distanceTo(at(to));
    this.handoffScroll(from, to, { color: opts.color, dur: opts.dur ?? 1.4, arc: 1.2 + dist * 0.12, onArrive });
  }
}

/**
 * AoE style selection ring under a unit or building: dashed ring that turns slowly when selected,
 * a thin still ring when hovered. Animates itself on render; no tick needed. Add ring.object3d as a child at y = 0.
 */
export class SelectionRing {
  readonly object3d: THREE.Group;
  private readonly dashes: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly dashM: THREE.MeshBasicMaterial;
  private readonly discM: THREE.MeshBasicMaterial;
  private selected = false;
  private hovered = false;
  private shownAt = 0;
  private readonly selColor = new THREE.Color();

  constructor(private readonly radius = 0.34, color: THREE.ColorRepresentation = "#7dff6a") {
    this.object3d = new THREE.Group();
    this.object3d.name = "art:selring";
    this.dashM = new THREE.MeshBasicMaterial({ map: dashedRingTexture(), color, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 });
    this.discM = new THREE.MeshBasicMaterial({ map: softRingTexture(), color, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.dashes = new THREE.Mesh(flatGeo(), this.dashM);
    this.disc = new THREE.Mesh(flatGeo(), this.discM);
    this.dashes.scale.setScalar(radius * 2.3);
    this.disc.scale.setScalar(radius * 2.6);
    this.dashes.position.y = 0.03;
    this.disc.position.y = 0.025;
    this.dashes.renderOrder = this.disc.renderOrder = 2;
    this.dashes.raycast = this.disc.raycast = () => {};
    this.object3d.add(this.disc, this.dashes);
    this.object3d.visible = false;
    this.selColor.set(color);
    const r = radius * 2.3;
    this.dashes.onBeforeRender = () => {
      const now = performance.now() / 1000;
      if (this.selected) {
        this.dashes.rotation.y = now * 0.8;
        const pop = Math.min(1, (now - this.shownAt) / 0.18);
        this.dashes.scale.setScalar(r * (1.35 - 0.35 * easeOut(pop)));
        this.discM.opacity = 0.28 + Math.sin(now * 4) * 0.08;
      }
    };
  }

  /** color is the selection colour (team colour); it is remembered, hover alone always shows a white ring. */
  set(o: { selected?: boolean; hovered?: boolean; color?: THREE.ColorRepresentation }) {
    const wasShown = this.selected;
    if (o.selected !== undefined) this.selected = o.selected;
    if (o.hovered !== undefined) this.hovered = o.hovered;
    if (o.color !== undefined) this.selColor.set(o.color);
    if (this.selected && !wasShown) this.shownAt = performance.now() / 1000;
    this.object3d.visible = this.selected || this.hovered;
    this.disc.visible = this.selected;
    this.dashM.opacity = this.selected ? 0.95 : 0.5;
    this.discM.color.copy(this.selColor);
    if (this.selected) this.dashM.color.copy(this.selColor);
    else { this.dashM.color.set("#ffffff"); this.dashes.rotation.y = 0; this.dashes.scale.setScalar(this.radius * 2.3); }
  }

  dispose() { this.dashM.dispose(); this.discM.dispose(); }
}
