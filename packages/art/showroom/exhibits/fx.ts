// Effects (raid-art-fx): each cell stages its own little scene (a Library and a unit, a camp, a trio) and fires
// ArtFx on a loop so a reviewer sees everything without clicking; the buttons fire each effect on demand.
// The ArtFx group lives in the scene (world space); points come from world transforms of the staged objects.
import * as THREE from "three";
import type { Exhibit, ExhibitCtx } from "../../src/types";
import { ArtFx, SelectionRing } from "../../src/fx/fx";
import { contactShadow } from "../../src/lighting";
import { makeUnit, type UnitHandle } from "../../src/units";
import { makeBuilding } from "../../src/world/buildings";

const RED = "#c0392b", BLUE = "#2e6fd1", GOLD = "#e2b23a";

function unit(cls: string, color: string, x: number, z: number, faceTo?: THREE.Vector3): UnitHandle {
  const u = makeUnit({ cls, teamColor: color, seed: Math.round(x * 13 + z * 7) });
  u.object3d.scale.setScalar(1.5);
  u.object3d.position.set(x, 0, z);
  if (faceTo) u.object3d.lookAt(faceTo.x, 0, faceTo.z);
  u.onStrike = null;
  return u;
}

/** Place an object at a local point (Object3D.position is read-only, it cannot be reassigned). */
function put<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, shadow = false): T {
  o.position.set(x, y, z);
  if (shadow) o.castShadow = true;
  return o;
}

/** Common cell plumbing: an ArtFx in world space, a list of tickers, an auto loop. */
function stage(ctx: ExhibitCtx) {
  const root = new THREE.Group();
  const fx = new ArtFx({ glowBudget: 500, puffBudget: 200 });
  ctx.scene.add(fx.group);
  const tickers: ((t: number, dt: number) => void)[] = [];
  const world = (o: THREE.Object3D, local = new THREE.Vector3()) => { o.updateWorldMatrix(true, false); return o.localToWorld(local.clone()); };
  const at = (x: number, y: number, z: number) => root.localToWorld(new THREE.Vector3(x, y, z));
  return {
    root, fx, tickers, world, at,
    tick(t: number, dt: number) { for (const f of tickers) f(t, dt); fx.tick(dt); },
    dispose() { ctx.scene.remove(fx.group); fx.glow.dispose(); fx.puff.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------------------

const memory: Exhibit = {
  name: "FX: GBrain recall (blue beam) and remember (gold orb)",
  area: "fx",
  span: 5,
  turntable: false,
  make(ctx) {
    const s = stage(ctx);
    const lib = makeBuilding("library");
    lib.object3d.position.set(-1, 0, -1);
    s.root.add(lib.object3d);
    const u = unit("knight", BLUE, 1.3, 1.3, new THREE.Vector3(-1, 0, -1));
    s.root.add(u.object3d); // makeUnit brings its own contact shadow
    const libPt = () => lib.anchor.getWorldPosition(new THREE.Vector3());
    const tip = () => u.staffTip(new THREE.Vector3());
    const recall = () => {
      u.play("cast");
      s.fx.recallBeam(libPt, tip, { ground: s.root.getWorldPosition(new THREE.Vector3()).y });
      for (let i = 0; i < 3; i++) s.fx.page(libPt, tip, 0.2 + i * 0.3, i === 0 ? () => s.fx.sparkle(tip(), "#bfe1ff", 10) : undefined);
      s.fx.after(0.9, () => s.fx.text(() => tip().add(new THREE.Vector3(0, 0.35, 0)), "billing-idempotency", { color: "#dcefff", bg: null, height: 0.24, dur: 2.4 }));
      s.fx.after(2.4, () => u.play("idle"));
    };
    const remember = () => {
      u.play("cast");
      s.fx.rememberOrb(tip(), libPt, () => {
        lib.pulse();
        s.fx.text(() => libPt().add(new THREE.Vector3(0, 0.4, 0)), "+1 page", { color: "#ffe9a8", bg: null, height: 0.3, dur: 2 });
      });
      s.fx.after(1.2, () => u.play("idle"));
    };
    let auto = true, next = 1, which = 0;
    s.tickers.push((t, dt) => {
      u.tick(t, dt);
      lib.tick(t, dt);
      if (auto && (next -= dt) <= 0) { next = 4; (which++ % 2 ? remember : recall)(); }
    });
    return {
      object3d: s.root,
      tick: s.tick,
      actions: { recall, remember, "auto on/off": () => { auto = !auto; } },
      dispose: () => { s.dispose(); u.dispose(); lib.dispose(); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------

const orders: Exhibit = {
  name: "FX: selection rings and order ping",
  area: "fx",
  span: 4,
  turntable: false,
  make(ctx) {
    const s = stage(ctx);
    const camp = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), new THREE.MeshLambertMaterial({ color: "#6fbf4a", flatShading: true }));
    camp.position.set(0.9, 0.24, -0.9);
    camp.castShadow = true;
    s.root.add(camp, put(contactShadow(0.45), 0.9, 0.012, -0.9));
    const us = [unit("knight", RED, -1, 0.6), unit("ranger", RED, -0.3, 1.2), unit("scout", BLUE, 0.9, 1.1)];
    const rings = us.map(() => new SelectionRing(0.3));
    us.forEach((u, i) => {
      u.object3d.add(rings[i].object3d);
      rings[i].object3d.scale.setScalar(1 / 1.5); // the ring lives inside the unit's 1.5 board scale
      s.root.add(u.object3d);
    });
    rings[0].set({ selected: true, color: RED });
    rings[1].set({ selected: true, color: RED });
    rings[2].set({ hovered: true });
    const campPt = () => s.world(camp).setY(s.root.getWorldPosition(new THREE.Vector3()).y + 0.02);
    const ping = () => { s.fx.orderPing(campPt(), RED); us.slice(0, 2).forEach((u) => u.play("work")); };
    const bad = () => s.fx.orderPing(s.at(-1.2, 0.02, -1.2), "#ff5a4a", 0.7);
    let sel = true, next = 0.8;
    s.tickers.push((t, dt) => {
      us.forEach((u) => u.tick(t, dt));
      camp.rotation.y += dt * 0.6;
      if ((next -= dt) <= 0) { next = 3; ping(); }
    });
    return {
      object3d: s.root,
      tick: s.tick,
      actions: {
        "order ping": ping,
        "invalid ping": bad,
        "spawn portal": () => s.fx.portal(s.at(-1.2, 0, -1.0)),
        "toggle select": () => { sel = !sel; rings[0].set({ selected: sel, color: RED }); rings[1].set({ selected: sel, color: RED }); },
        "hover blue": () => rings[2].set({ hovered: true, selected: false }),
        "select blue": () => rings[2].set({ selected: true, color: BLUE }),
      },
      dispose: () => { s.dispose(); us.forEach((u) => u.dispose()); rings.forEach((r) => r.dispose()); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------

const ambient: Exhibit = {
  name: "FX: walk dust, forge sparks and smoke, victory flag",
  area: "fx",
  span: 4,
  turntable: false,
  make(ctx) {
    const s = stage(ctx);
    // A unit walking a circle kicks up dust.
    const walker = unit("scout", GOLD, 0, 0);
    walker.play("walk");
    s.root.add(walker.object3d);
    // A little anvil with a furnace glow stands in for the Forge.
    const anvil = new THREE.Group();
    const iron = new THREE.MeshLambertMaterial({ color: "#3b3b40", flatShading: true });
    anvil.add(put(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.16), iron), 0, 0.3, 0, true));
    anvil.add(put(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.24, 6), iron), 0, 0.12, 0, true));
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), new THREE.MeshLambertMaterial({ color: "#7c6f62", flatShading: true }));
    chimney.position.set(-0.45, 0.55, -0.3);
    chimney.castShadow = true;
    anvil.add(chimney, contactShadow(0.35));
    anvil.position.set(1.1, 0, -1.1);
    s.root.add(anvil);
    let flag: { remove(): void } | null = null;
    const plant = () => { flag?.remove(); flag = s.fx.flag(s.at(-1.2, 0, -1.2), BLUE, { dur: 6 }); };
    let a = 0, dustT = 0, sparkT = 1, smokeT = 0, flagT = 0.5;
    s.tickers.push((t, dt) => {
      a += dt * 0.7;
      const r = 1.1;
      walker.object3d.position.set(Math.cos(a) * r - 0.2, 0, Math.sin(a) * r + 0.3);
      walker.object3d.rotation.y = -a; // tangent of the circle, facing forward
      walker.tick(t, dt);
      if ((dustT -= dt) <= 0) { dustT = 0.22; s.fx.dust(s.world(walker.object3d)); }
      if ((sparkT -= dt) <= 0) { sparkT = 0.7; s.fx.forgeSparks(s.world(anvil, new THREE.Vector3(0, 0.38, 0))); }
      if ((smokeT -= dt) <= 0) { smokeT = 0.18; s.fx.smoke(s.world(chimney, new THREE.Vector3(0, 0.6, 0))); }
      if ((flagT -= dt) <= 0) { flagT = 8; plant(); }
    });
    return {
      object3d: s.root,
      tick: s.tick,
      actions: {
        "plant flag": plant,
        "forge burst": () => s.fx.forgeSparks(s.world(anvil, new THREE.Vector3(0, 0.38, 0)), 3),
        sparkle: () => s.fx.sparkle(s.world(walker.object3d, new THREE.Vector3(0, 0.4, 0)), "#fff2b0", 20),
        "dust cloud": () => s.fx.dust(s.world(walker.object3d), 10),
      },
      dispose: () => { s.dispose(); walker.dispose(); },
    };
  },
};

// ---------------------------------------------------------------------------------------------------------

const handoff: Exhibit = {
  name: "FX: workflow handoff scrolls (planner, implementer, reviewer, changes loop)",
  area: "fx",
  span: 4,
  turntable: false,
  make(ctx) {
    const s = stage(ctx);
    const c = new THREE.Vector3(0, 0, 0);
    const planner = unit("oracle", RED, -1.2, 0.9, c);
    const impl = unit("knight", RED, 0, -1.1, c);
    const rev = unit("ranger", RED, 1.2, 0.9, c);
    s.root.add(planner.object3d, impl.object3d, rev.object3d);
    const tip = (u: UnitHandle) => () => u.staffTip(new THREE.Vector3());
    const pass = (a: UnitHandle, b: UnitHandle, verdict: string | undefined, label: string, then?: () => void) => {
      a.play("cast");
      s.fx.handoffScroll(tip(a), tip(b), {
        verdict, label,
        onArrive: () => { a.play("idle"); b.play(verdict === "approve" ? "celebrate" : "work"); then?.(); },
      });
    };
    // The trio script: [from, to, verdict, label, pause before the next step]
    const steps: [UnitHandle, UnitHandle, string | undefined, string, number][] = [
      [planner, impl, undefined, "plan", 1.2],
      [impl, rev, undefined, "patch", 1.0],
      [rev, impl, "changes", "changes requested", 1.2],
      [impl, rev, undefined, "patch v2", 1.0],
      [rev, planner, "approve", "approved", 0],
    ];
    let running = false;
    const step = (i: number) => {
      if (i >= steps.length) {
        s.fx.flag(s.at(0, 0, 0.1), RED, { dur: 3 });
        s.fx.after(3.5, () => { [planner, impl, rev].forEach((u) => u.play("idle")); running = false; });
        return;
      }
      const [a, b, verdict, label, pause] = steps[i];
      pass(a, b, verdict, label, () => s.fx.after(pause, () => step(i + 1)));
    };
    const run = () => { if (!running) { running = true; step(0); } };
    let next = 1;
    s.tickers.push((t, dt) => {
      [planner, impl, rev].forEach((u) => u.tick(t, dt));
      if (!running && (next -= dt) <= 0) { next = 2; run(); }
    });
    return {
      object3d: s.root,
      tick: s.tick,
      actions: {
        "run trio": run,
        "scroll approve": () => pass(rev, planner, "approve", "approved"),
        "scroll changes": () => pass(rev, impl, "changes", "changes requested"),
      },
      dispose: () => { s.dispose(); [planner, impl, rev].forEach((u) => u.dispose()); },
    };
  },
};

const exhibits: Exhibit[] = [memory, orders, ambient, handoff];
export default exhibits;
