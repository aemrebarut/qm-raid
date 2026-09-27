// Lighting rig for the board: warm late-afternoon sun with soft shadows, cool sky fill, a faint rim light,
// light depth haze and ACES tone mapping. Also cheap readability helpers (contact shadows) instead of SSAO.
// No post-processing: everything here is a forward-render setting, so it keeps 60 fps on a laptop.
import * as THREE from "three";
import { contactShadowTexture } from "./fx/textures";
import type { Lighting, LightingOpts } from "./types";

export interface ArtLightingOpts extends LightingOpts {
  /** Centre of the map in world space; defaults to (mapSize / 2, 0, mapSize / 2). */
  center?: THREE.Vector3;
  /** Set scene.background (a colour); leave undefined to keep the caller's background. */
  background?: THREE.ColorRepresentation;
  /** Depth haze; false disables. Default on, subtle. */
  fog?: boolean;
  /** Tone mapping exposure; default 1.15 (ACES darkens mid-tones). */
  exposure?: number;
  /** Shadow map resolution; default 2048. Use 1024 on weak GPUs. */
  shadowMapSize?: number;
}

export interface LightingRig extends Lighting {
  rim: THREE.DirectionalLight;
  fog: THREE.Fog | null;
  /** Re-centre the sun and its shadow frustum on a world point (for example the camera target). */
  follow(p: THREE.Vector3): void;
  /** Blend between presets: 0 = midday, 1 = golden hour (default 0.75). */
  setWarmth(k: number): void;
  dispose(): void;
}

// Sun direction: from the south-west and fairly low, so shadows fall toward the back-right of the iso view
// and every building has a lit face and a shaded face (the classic RTS read).
const SUN_DIR = new THREE.Vector3(-0.62, 0.62, 0.48).normalize();
const SUN_DIST = 30;

const MIDDAY = { sun: new THREE.Color("#fff4e0"), sunI: 2.6, sky: new THREE.Color("#d6e6ff"), ground: new THREE.Color("#5d5236"), hemiI: 1.25, rim: new THREE.Color("#b7c9ff"), rimI: 0.35, fog: new THREE.Color("#c9d6c4") };
const GOLDEN = { sun: new THREE.Color("#ffd49a"), sunI: 3.0, sky: new THREE.Color("#b9cff2"), ground: new THREE.Color("#6b5433"), hemiI: 1.1, rim: new THREE.Color("#8fa8ff"), rimI: 0.45, fog: new THREE.Color("#d9c7a2") };

export function lighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, opts: ArtLightingOpts = {}): LightingRig {
  const size = opts.mapSize ?? 24;
  const center = opts.center?.clone() ?? new THREE.Vector3(size / 2, 0, size / 2);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCFSoft was removed; PCF + shadow.radius is the soft path

  const hemi = new THREE.HemisphereLight(GOLDEN.sky, GOLDEN.ground, GOLDEN.hemiI);
  hemi.name = "art:hemi";

  const sun = new THREE.DirectionalLight(GOLDEN.sun, GOLDEN.sunI);
  sun.name = "art:sun";
  sun.castShadow = true;
  const ms = opts.shadowMapSize ?? 2048;
  sun.shadow.mapSize.set(ms, ms);
  const half = size * 0.85; // the iso diamond plus tall buildings at the corners
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
  sc.near = 1; sc.far = SUN_DIST * 2.2;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 3;       // soft edges
  sun.shadow.intensity = 0.72; // shadows keep some sky colour instead of going black

  // Cool back-light from the opposite side: separates silhouettes from the grass (cheap outline substitute).
  const rim = new THREE.DirectionalLight(GOLDEN.rim, GOLDEN.rimI);
  rim.name = "art:rim";

  let fog: THREE.Fog | null = null;
  if (opts.fog !== false) {
    // The iso camera sits ~60 units away; the far edge of the map is ~75. Haze only the far half, lightly.
    fog = new THREE.Fog(GOLDEN.fog.clone(), 62, 125);
    scene.fog = fog;
  }
  if (opts.background !== undefined) scene.background = new THREE.Color(opts.background);

  function follow(p: THREE.Vector3) {
    center.copy(p);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(SUN_DIR, SUN_DIST);
    rim.target.position.copy(center);
    rim.position.copy(center).add(new THREE.Vector3(SUN_DIR.x * -SUN_DIST, SUN_DIST * 0.5, SUN_DIR.z * -SUN_DIST));
    sun.target.updateMatrixWorld();
    rim.target.updateMatrixWorld();
  }
  follow(center);

  function setWarmth(k: number) {
    const t = THREE.MathUtils.clamp(k / 0.75, 0, 1.2);
    const mix = (a: THREE.Color, b: THREE.Color) => a.clone().lerp(b, t);
    sun.color.copy(mix(MIDDAY.sun, GOLDEN.sun));
    sun.intensity = THREE.MathUtils.lerp(MIDDAY.sunI, GOLDEN.sunI, t);
    hemi.color.copy(mix(MIDDAY.sky, GOLDEN.sky));
    hemi.groundColor.copy(mix(MIDDAY.ground, GOLDEN.ground));
    hemi.intensity = THREE.MathUtils.lerp(MIDDAY.hemiI, GOLDEN.hemiI, t);
    rim.color.copy(mix(MIDDAY.rim, GOLDEN.rim));
    rim.intensity = THREE.MathUtils.lerp(MIDDAY.rimI, GOLDEN.rimI, t);
    fog?.color.copy(mix(MIDDAY.fog, GOLDEN.fog));
  }
  setWarmth(0.75);

  scene.add(hemi, sun, sun.target, rim, rim.target);

  return {
    sun, hemi, rim, fog, follow, setWarmth,
    /** Per frame; static rig for now (cheap). Kept so the showroom and board can call it unconditionally. */
    update() {},
    dispose() {
      scene.remove(hemi, sun, sun.target, rim, rim.target);
      sun.shadow.map?.dispose();
      if (scene.fog === fog) scene.fog = null;
    },
  };
}

/**
 * Remove lights the caller added before switching to lighting() (the board's old sun and hemisphere),
 * so the swap behind a flag is one call. Returns the removed lights.
 */
export function removeLights(scene: THREE.Scene) {
  const gone: THREE.Light[] = [];
  for (const o of [...scene.children]) {
    if (o instanceof THREE.Light && !o.name.startsWith("art:")) { scene.remove(o); gone.push(o); }
  }
  return gone;
}

let contactGeo: THREE.PlaneGeometry | null = null;
const contactMats = new Map<number, THREE.MeshBasicMaterial>();

/**
 * Soft dark blob to put under a unit, tree, rock or building: fakes ambient occlusion where it meets the ground,
 * which is what makes low-poly objects look planted. radius in world units; add it as a child at y = 0.
 */
export function contactShadow(radius = 0.4, opacity = 0.6, stretch = 1) {
  contactGeo ??= new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  contactGeo.userData.shared = true;
  const key = Math.round(opacity * 100);
  let m = contactMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: contactShadowTexture(), transparent: true, opacity, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false,
    });
    contactMats.set(key, m);
  }
  const mesh = new THREE.Mesh(contactGeo, m);
  mesh.name = "art:contact";
  mesh.scale.set(radius, 1, radius * stretch);
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  mesh.raycast = () => {}; // never steals picks
  return mesh;
}
