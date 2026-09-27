// Isometric orthographic camera: 2:1 dimetric (30 deg elevation, 45 deg azimuth), pan and zoom.
import * as THREE from "three";

export const MAP_SIZE = 24;
const ELEV = THREE.MathUtils.degToRad(30);
const AZIM = THREE.MathUtils.degToRad(45);
const DIST = 60;
const VIEW_H = 17; // world units visible vertically at zoom 1

// Ground directions for screen right and screen up (camera sits at +x +z looking toward -x -z).
const RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const UP_GROUND = new THREE.Vector3(-1, 0, -1).normalize();

export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3(MAP_SIZE / 2, 0, MAP_SIZE / 2 + 1);
  private width = 1;
  private height = 1;
  private readonly offset = new THREE.Vector3(
    DIST * Math.cos(ELEV) * Math.sin(AZIM),
    DIST * Math.sin(ELEV),
    DIST * Math.cos(ELEV) * Math.cos(AZIM),
  );
  private readonly ray = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.zoom = 1;
    this.update();
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const aspect = this.width / this.height;
    this.camera.left = (-VIEW_H * aspect) / 2;
    this.camera.right = (VIEW_H * aspect) / 2;
    this.camera.top = VIEW_H / 2;
    this.camera.bottom = -VIEW_H / 2;
    this.camera.updateProjectionMatrix();
  }

  update() {
    const t = this.target;
    t.x = THREE.MathUtils.clamp(t.x, -2, MAP_SIZE + 2);
    t.z = THREE.MathUtils.clamp(t.z, -2, MAP_SIZE + 2);
    this.camera.position.copy(t).add(this.offset);
    this.camera.lookAt(t);
    this.camera.updateMatrixWorld();
  }

  private worldPerPixel() {
    return VIEW_H / this.camera.zoom / this.height;
  }

  /** Drag by screen pixels: the world follows the pointer. */
  panPixels(dx: number, dy: number) {
    const wpp = this.worldPerPixel();
    this.target.addScaledVector(RIGHT, -dx * wpp);
    this.target.addScaledVector(UP_GROUND, (dy * wpp) / Math.sin(ELEV));
    this.update();
  }

  /** Keyboard pan in screen directions (right, up), in world units. */
  panScreen(right: number, up: number) {
    this.target.addScaledVector(RIGHT, right / this.camera.zoom);
    this.target.addScaledVector(UP_GROUND, up / this.camera.zoom / Math.sin(ELEV));
    this.update();
  }

  focus(x: number, z: number) {
    this.target.set(x, 0, z);
    this.update();
  }

  /** Point on the ground plane under a canvas-relative NDC coordinate. */
  groundAt(ndc: THREE.Vector2): THREE.Vector3 | null {
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, hit) ? hit : null;
  }

  /** Zoom by a factor, keeping the ground point under the cursor fixed. */
  zoomAt(factor: number, ndc: THREE.Vector2) {
    const before = this.groundAt(ndc);
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, 0.55, 3.2);
    this.camera.updateProjectionMatrix();
    this.update();
    const after = this.groundAt(ndc);
    if (before && after) {
      this.target.add(before.sub(after));
      this.update();
    }
  }
}
