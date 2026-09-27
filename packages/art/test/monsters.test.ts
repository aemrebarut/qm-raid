// raid-art-units: target state round trips (review P2s on aaed54f).
import { beforeAll, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { makeTarget } from "../src/monsters";

// contactShadow draws its blob texture on a canvas: happy-dom plus a no-op 2D context (same stub as fx.test.ts).
beforeAll(() => {
  const w = new Window();
  const noop = new Proxy({}, { get: (_t, k) => (k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
  (w.HTMLCanvasElement.prototype as any).getContext = () => noop;
  (globalThis as any).document ??= w.document;
});

function skinRGB(m: ReturnType<typeof makeTarget>) {
  const sm = m.object3d.getObjectByName("baked:vc:skin") as any;
  const c = sm.geometry.getAttribute("color");
  return [c.getX(0), c.getY(0), c.getZ(0), sm.material.emissive.r];
}
test("hit then defeat clears flash; reopen restores skin and ring", () => {
  for (const kind of ["bug", "feature"] as const) for (const sev of [1, 2, 3, 4]) {
    const m = makeTarget({ kind, severity: sev });
    m.tick(0, 0.016);
    const sm = m.object3d.getObjectByName("baked:vc:skin") as any;
    const before = sm ? skinRGB(m) : null;
    m.hit(); m.tick(0.01, 0.01); m.defeat();
    for (let t = 0; t < 2; t += 0.1) m.tick(t, 0.1);
    if (sm) expect(sm.material.emissive.r).toBe(0);
    m.setState("open"); m.tick(3, 0.016);
    if (sm) expect(skinRGB(m)).toEqual(before!);
    m.object3d.traverse((o: any) => { if (o.isBone) { expect(o.scale.x).toBeGreaterThan(0.2); } });
    m.dispose();
  }
});
