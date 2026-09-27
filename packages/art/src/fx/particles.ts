// Pooled point particles: one draw call per pool, fixed budget, ring-buffer allocation.
// GlowPool is additive (sparks, glyph motes, embers); PuffPool is alpha-blended (dust, smoke).
import * as THREE from "three";
import { glowTexture, puffTexture } from "./textures";

export interface EmitOpts {
  color: THREE.ColorRepresentation;
  speed: number;       // initial speed, randomised 40..100%
  life: number;        // seconds, randomised 60..100%
  gravity?: number;    // world units / s^2 downward (negative floats up)
  up?: number;         // vertical bias of the launch direction
  size?: number;       // world units at zoom 1
  spread?: number;     // random start offset radius
  drag?: number;       // velocity damping per second (0..)
  grow?: number;       // size multiplier at end of life
}

// Per-particle size and alpha need a small custom shader; PointsMaterial has neither per-vertex size nor alpha.
const vert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Size in world units: scale by the projection (ortho zoom, or perspective depth) and the viewport height.
    float persp = projectionMatrix[3][3] > 0.5 ? 1.0 : 1.0 / max(0.001, -mv.z);
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] * persp;
  }
`;
const frag = /* glsl */ `
  uniform sampler2D uMap;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.01) discard;
    #include <colorspace_fragment>
  }
`;

class Pool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly max: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array;
  private next = 0;
  private alive = 0;
  private readonly mat: THREE.ShaderMaterial;

  constructor(private readonly n: number, map: THREE.Texture, additive: boolean, private readonly fadeIn: boolean) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 400 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false, // keep glows punchy under ACES
    });
    this.points = new THREE.Points(g, this.mat);
    const buf = new THREE.Vector2();
    this.points.onBeforeRender = (renderer) => { this.mat.uniforms.uScale.value = renderer.getDrawingBufferSize(buf).y / 2; };
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 3;
  }

  emit(p: THREE.Vector3, count: number, o: EmitOpts) {
    const c = new THREE.Color(o.color);
    const spread = o.spread ?? 0;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const a = Math.random() * Math.PI * 2, s = o.speed * (0.4 + Math.random() * 0.6);
      const r = spread * Math.sqrt(Math.random());
      this.pos[i * 3] = p.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z + Math.sin(a) * r;
      this.vel[i * 3] = Math.cos(a) * s;
      this.vel[i * 3 + 1] = (o.up ?? 0.5) * s * (0.5 + Math.random());
      this.vel[i * 3 + 2] = Math.sin(a) * s;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.life[i] = this.max[i] = o.life * (0.6 + Math.random() * 0.4);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.size0[i] = (o.size ?? 0.12) * (0.7 + Math.random() * 0.6);
      this.grow[i] = o.grow ?? 1;
    }
    this.alive = this.n; // cheap: tick scans until everything is dead again
  }

  /** Emit one particle with an explicit velocity (trails, beams). */
  emitAt(p: THREE.Vector3, v: THREE.Vector3, o: EmitOpts) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const c = new THREE.Color(o.color);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.life[i] = this.max[i] = o.life;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.size0[i] = o.size ?? 0.12;
    this.grow[i] = o.grow ?? 1;
    this.alive = this.n;
  }

  tick(dt: number) {
    if (!this.alive) return;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      live++;
      this.life[i] -= dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]); // 1 -> 0
      const k = 1 - f;
      this.alpha[i] = this.fadeIn ? Math.min(1, k * 6) * f : f;
      this.size[i] = this.size0[i] * (1 + (this.grow[i] - 1) * k);
    }
    if (!live) this.alive = 0;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true;
    a.aColor.needsUpdate = true;
    a.aSize.needsUpdate = true;
    a.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/** Additive glowing particles (sparks, motes, embers). */
export class GlowPool extends Pool {
  constructor(n = 600) { super(n, glowTexture(), true, false); }
}

/** Soft alpha-blended puffs (dust, smoke); fade in quickly, grow, fade out. */
export class PuffPool extends Pool {
  constructor(n = 300) { super(n, puffTexture(), false, true); }
}
