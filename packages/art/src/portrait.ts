// HUD portraits rendered from the real unit model: a bust shot per class and team colour, as a PNG data URL.
// One shared offscreen WebGLRenderer for every portrait (the HUD never opens a context per image); cached by
// options, so calling it on every HUD render is cheap after the first time.
import * as THREE from "three";
import { makeUnit } from "./units";
import type { UnitAnim, UnitOpts } from "./types";

export interface PortraitOpts extends UnitOpts {
  size?: number;              // square, CSS pixels times devicePixelRatio if you want it crisp (default 128)
  anim?: UnitAnim;            // pose (default idle)
  background?: string | null; // null = transparent (default)
  /** "bust" (head and shoulders, default) or "full" (whole figure with staff). */
  shot?: "bust" | "full";
}

let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight("#dfe9ff", "#6b5433", 1.25));
  const key = new THREE.DirectionalLight("#ffd9a8", 2.6);
  key.position.set(1, 2, 2);
  const rim = new THREE.DirectionalLight("#9fb4ff", 1.1);
  rim.position.set(-1.5, 1.2, -1.5);
  scene.add(key, rim);
}

export function unitPortrait(o: PortraitOpts): string {
  const size = Math.max(16, Math.round(o.size ?? 128));
  const shot = o.shot ?? "bust";
  const key = JSON.stringify([o.cls, o.teamColor ?? null, !!o.forged, o.typeColor ?? null, size, o.anim ?? "idle", o.background ?? null, shot]);
  const hit = cache.get(key);
  if (hit) return hit;

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  if (o.background) renderer.setClearColor(o.background, 1);
  else renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  lights(scene);
  const u = makeUnit(o);
  u.play(o.anim ?? "idle");
  for (let i = 0; i < 20; i++) u.tick(i / 60, 1 / 60); // settle the pose blend
  u.object3d.rotation.y = -0.35; // three-quarter view, facing slightly left like an RTS portrait
  scene.add(u.object3d);

  // Units: feet at 0, shoulders about 0.5, head top about 0.8 (scale 1).
  const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  if (shot === "bust") { cam.position.set(0.22, 0.72, 1.4); cam.lookAt(0, 0.63, 0); }
  else { cam.position.set(0.5, 0.75, 2.6); cam.lookAt(0, 0.45, 0); }

  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(u.object3d);
  u.dispose();
  cache.set(key, url);
  return url;
}

/** Free the shared renderer (tests, hot reload). Cached URLs stay valid. */
export function disposePortraits() {
  renderer?.dispose();
  renderer = null;
}
