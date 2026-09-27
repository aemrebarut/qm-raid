// Order arrows: marching dashed arcs for autopilot proposals (ghost arrows), thin solid arcs for active orders
// of selected units. Arcs are drawn on top of everything so they read over walls.
import * as THREE from "three";
import type { Order, State } from "../core";
import type { UnitView } from "./units";
import type { TargetView } from "./targets";

const DASH = new THREE.BoxGeometry(0.11, 0.05, 0.3);
const SEG = new THREE.BoxGeometry(0.05, 0.03, 1);
const HEAD = new THREE.ConeGeometry(0.2, 0.45, 6).rotateX(Math.PI / 2); // points along +z
const N_DASH = 16, N_SEG = 18;

type Kind = "proposed" | "active";

class Arrow {
  readonly group = new THREE.Group();
  readonly mat: THREE.MeshBasicMaterial;
  private readonly parts: THREE.Mesh[] = [];
  private readonly head: THREE.Mesh;
  constructor(readonly kind: Kind, color: string, public unitId: string, public targetId: string) {
    // Lift the team colour toward white so the arc reads on any ground.
    const c = new THREE.Color(color).lerp(new THREE.Color("#ffffff"), kind === "proposed" ? 0.35 : 0.2);
    this.mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: kind === "proposed" ? 0.9 : 0.55, depthTest: false, depthWrite: false });
    const n = kind === "proposed" ? N_DASH : N_SEG;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(kind === "proposed" ? DASH : SEG, this.mat);
      m.renderOrder = 8;
      this.parts.push(m);
      this.group.add(m);
    }
    this.head = new THREE.Mesh(HEAD, this.mat);
    this.head.renderOrder = 8;
    this.group.add(this.head);
  }

  update(a: THREE.Vector3, b: THREE.Vector3, t: number) {
    const dist = a.distanceTo(b);
    const ctrl = a.clone().add(b).multiplyScalar(0.5);
    ctrl.y += 0.5 + dist * 0.28;
    const curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    const end = 0.93; // leave room for the head
    if (this.kind === "proposed") {
      const phase = (t * 0.8) % 1;
      this.parts.forEach((m, i) => {
        const u = ((i + phase) / this.parts.length) * end;
        curve.getPoint(u, p);
        curve.getPoint(Math.min(1, u + 0.01), q);
        m.position.copy(p);
        m.lookAt(q);
      });
      this.mat.opacity = 0.8 + Math.sin(t * 5) * 0.2;
    } else {
      this.parts.forEach((m, i) => {
        curve.getPoint((i / this.parts.length) * end, p);
        curve.getPoint(((i + 1) / this.parts.length) * end, q);
        m.position.copy(p).add(q).multiplyScalar(0.5);
        m.lookAt(q);
        m.scale.set(1, 1, p.distanceTo(q));
      });
    }
    curve.getPoint(end, p);
    curve.getPoint(1, q);
    this.head.position.copy(p);
    this.head.lookAt(q);
  }

  dispose() { this.mat.dispose(); }
}

export class ArrowLayer {
  readonly group = new THREE.Group();
  private readonly arrows = new Map<string, Arrow>();

  /** Rebuild the set of arrows from state and the current unit selection. */
  sync(s: State, selectedUnits: Set<string>, teamColor: (team: number | null) => string | null) {
    const want = new Map<string, { o: Order; kind: Kind }>();
    for (const o of s.orders) {
      if (o.status === "proposed") want.set(o.id, { o, kind: "proposed" });
      else if (o.status === "active" && selectedUnits.has(o.unitId)) want.set(o.id, { o, kind: "active" });
    }
    for (const [id, a] of this.arrows) {
      const w = want.get(id);
      if (!w || w.kind !== a.kind || w.o.unitId !== a.unitId || w.o.targetId !== a.targetId) {
        this.group.remove(a.group);
        a.dispose();
        this.arrows.delete(id);
      }
    }
    for (const [id, { o, kind }] of want) {
      if (this.arrows.has(id)) continue;
      const unit = s.units.find((u) => u.id === o.unitId);
      const color = kind === "active" ? "#9dff7a" : teamColor(unit?.team ?? null) ?? "#f2e27a";
      const a = new Arrow(kind, color, o.unitId, o.targetId);
      this.arrows.set(id, a);
      this.group.add(a.group);
    }
  }

  tick(t: number, units: Map<string, UnitView>, targets: Map<string, TargetView>) {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const arrow of this.arrows.values()) {
      const u = units.get(arrow.unitId), tg = targets.get(arrow.targetId);
      arrow.group.visible = !!(u && tg);
      if (!u || !tg) continue;
      a.copy(u.group.position).setY(0.5);
      b.copy(tg.group.position).setY(0.45);
      arrow.update(a, b, t);
    }
  }
}
