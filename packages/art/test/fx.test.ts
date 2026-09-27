// ArtFx lifecycle (raid-art-fx): effects end, callbacks fire once, flags and rings behave. happy-dom for canvas stubs.
import { beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import * as THREE from "three";

let ArtFx: typeof import("../src/fx/fx").ArtFx;
let SelectionRing: typeof import("../src/fx/fx").SelectionRing;

beforeAll(async () => {
  const w = new Window();
  // Canvas 2D is not implemented in happy-dom; a no-op context is enough for texture creation.
  const noop = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  (w.HTMLCanvasElement.prototype as any).getContext = () => noop;
  (globalThis as any).document = w.document;
  ({ ArtFx, SelectionRing } = await import("../src/fx/fx"));
});

const run = (fx: InstanceType<typeof ArtFx>, secs: number) => { for (let i = 0; i < secs * 60; i++) fx.tick(1 / 60); };

test("recall, remember, page and scroll finish and call back once", () => {
  const fx = new ArtFx();
  const a = new THREE.Vector3(0, 3, 0), b = () => new THREE.Vector3(3, 1, 3);
  const calls = { orb: 0, page: 0, scroll: 0 };
  fx.recallBeam(a, b);
  fx.rememberOrb(b(), a, () => calls.orb++);
  fx.page(a, b, 0.2, () => calls.page++);
  fx.scroll(b, a, { color: "#c0392b" }, () => calls.scroll++);
  fx.handoffScroll(a, b, { verdict: "changes", label: "changes requested" });
  fx.portal(new THREE.Vector3(1, 0, 1));
  fx.orderPing(new THREE.Vector3(), "#ff0000");
  fx.burst(new THREE.Vector3(), "#ffffff");
  fx.text(a, "hello");
  run(fx, 10);
  expect(calls).toEqual({ orb: 1, page: 1, scroll: 1 });
  expect(fx.active).toBe(0);
  expect(fx.group.children.length).toBe(2); // only the two particle pools remain
});

test("flag with dur Infinity is removed and its effect ends", () => {
  const fx = new ArtFx();
  const f = fx.flag(new THREE.Vector3(), "#2e6fd1", { dur: Infinity });
  run(fx, 2);
  expect(fx.group.children).toContain(f.object3d);
  f.remove();
  run(fx, 2);
  expect(fx.group.children).not.toContain(f.object3d);
  expect(fx.active).toBe(0);
});

test("selection ring keeps its selection colour across hover", () => {
  const r = new SelectionRing(0.3, "#00ff00");
  r.set({ hovered: true });
  r.set({ selected: true });
  const dash = (r.object3d.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
  expect(dash.color.getHexString()).toBe("00ff00");
  r.set({ selected: false });
  expect(dash.color.getHexString()).toBe("ffffff");
  r.set({ selected: true, color: "#ff0000" });
  expect(dash.color.getHexString()).toBe("ff0000");
});
