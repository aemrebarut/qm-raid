// The art API: handles every factory returns. Owned by raid-art-plan; ask before changing a shape.
// Conventions (all factories):
// - three only, no board or contract imports, no game logic. Colours are CSS strings.
// - 1 world unit = 1 tile. Map tile (x, y) has its centre at world (x + 0.5, 0, y + 0.5); y is up.
// - Objects are built around the origin, facing +z (south, toward the camera), resting on y = 0.
//   Terrain and zones are the exception: they come back in world coordinates for a size x size map.
// - The walkable area (zones, roads, building fronts) stays flat at y = 0, so units need no height lookup.
// - tick(t, dt): t = seconds since start, dt = seconds since last frame. No allocation per frame.
// - dispose() frees what the handle created (not shared geometries or materials cached at module level).
// - Shadows: meshes set castShadow and receiveShadow themselves.
import type * as THREE from "three";

export interface Handle {
  object3d: THREE.Object3D;
  dispose(): void;
}

// ---- units (raid-art-units, src/units.ts) ----
export type UnitAnim = "idle" | "walk" | "work" | "cast" | "celebrate" | "error";
export interface UnitOpts {
  /** knight | ranger | scout | oracle, or a forged type id (anything else). */
  cls: string;
  teamColor?: string | null; // null = neutral grey
  forged?: boolean;          // forged River type: glowing runes in typeColor
  typeColor?: string | null;
  seed?: number;
}
/** Feet at y = 0, faces +z, about 0.8 tall at scale 1 (the board applies its own 1.5 scale). */
export interface UnitArt extends Handle {
  play(anim: UnitAnim): void; // blends from the current pose, idempotent
  tick(t: number, dt: number): void;
  setTeamColor(color: string | null): void;
  /** World position of the staff gem (beam and orb anchor). */
  staffTip(out?: THREE.Vector3): THREE.Vector3;
  /** Called at the peak of each work strike with the world impact point (the board spawns sparks). */
  onStrike: ((p: THREE.Vector3) => void) | null;
}

// ---- monsters and camps (raid-art-units, src/monsters.ts) ----
export type TargetState = "open" | "engaged" | "resolved";
export interface TargetOpts {
  kind: "bug" | "feature"; // bug = slime or goblin camp, feature = crystal or ruin
  severity: number;        // 1..4, bigger and meaner with severity
  seed?: number;
}
/** Fits a radius of about 0.35 + 0.1 * severity around the origin. */
export interface TargetArt extends Handle {
  tick(t: number, dt: number): void;
  setState(s: TargetState): void;
  hit(): void;    // short flinch, called on each unit strike
  defeat(): void; // one-shot collapse, then stays in the resolved look
}

// ---- buildings, terrain, zones, props (raid-art-world, src/world/) ----
export type BuildingKind = "library" | "barracks" | "forge"; // contract kinds gbrain, barracks, river
export interface BuildingOpts { level?: number; seed?: number }
/** 3 x 3 tile footprint centred on the origin, door on the +z side. Model only: the board keeps its platform, ring, label and progress banner. */
export interface BuildingArt extends Handle {
  /** Effect anchor: the Library orb or window, the Forge fire. */
  anchor: THREE.Object3D;
  /** Local point in front of the door (spawned units appear here). */
  door: THREE.Vector3;
  /** Local point at the spire or chimney top. */
  top: THREE.Vector3;
  tick(t: number, dt: number): void;
  pulse(): void;          // Library on remember, Barracks and Forge on spawn
  glow(on: boolean): void; // selected or busy highlight
  setWork(progress: number | null): void; // Forge: furnace roars while training (0..1), null = idle
}
export interface TerrainSpec {
  size: number;            // tiles per side (24)
  seed?: number;
  paths?: [number, number][][]; // road polylines in tile coordinates
  blocked?: [number, number][]; // tiles to keep clear of trees and rocks (zones, buildings, targets)
}
export interface ZoneSpec {
  x: number; y: number; w: number; h: number; // tiles
  color: string;
  name?: string;
  gate?: { side: "n" | "s" | "e" | "w"; x: number; y: number };
}
export interface PropsSpec {
  seed?: number;
  spots: { x: number; y: number; kind?: string }[]; // tile coordinates
}

// ---- lighting and effects (raid-art-fx, src/lighting.ts, src/fx/) ----
export interface LightingOpts { mapSize?: number }
export interface Lighting {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  update(): void;
  dispose(): void;
}

// ---- showroom ----
/** One showroom exhibit. Files in showroom/exhibits/*.ts default-export Exhibit[]. */
export interface Exhibit {
  name: string;
  area: "units" | "monsters" | "world" | "fx" | "lighting";
  /** Cell size in tiles (default 3); terrain and zones use more. */
  span?: number;
  /** Rotate on the turntable (default true; world pieces in world coordinates say false). */
  turntable?: boolean;
  make(ctx: ExhibitCtx): ExhibitInstance;
}
export interface ExhibitCtx {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  /** Cell centre in world space; the exhibit's object3d is placed there by the showroom. */
  origin: THREE.Vector3;
}
export interface ExhibitInstance {
  object3d: THREE.Object3D;
  tick?(t: number, dt: number): void;
  /** Buttons shown under the exhibit name, e.g. { walk: () => u.play("walk") }. */
  actions?: Record<string, () => void>;
  dispose?(): void;
}
