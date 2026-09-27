// Rigid bake (raid-art-units): turns a hierarchy of small meshes hung on THREE.Bone joints into a few SkinnedMeshes
// (one per material bucket) that share one skeleton. Each vertex is bound to its nearest Bone ancestor with weight 1,
// so animating the bones animates the parts exactly as before, at 1 to 5 draw calls instead of 30 to 100.
//
// Buckets, decided by the part's material:
// - default: merged into the vertex-coloured bucket "main" (colour = material.color), drawn with one Lambert material.
// - material.userData.bucket = "<name>": a separate vertex-coloured bucket (for example "skin", which can flash).
// - material.userData.bake = "own": parts keep that exact material (emissive glows), one bucket per material.
// - material.userData.tag = "<tag>": its vertex ranges are recorded so recolor(tag, colour) can repaint them.
// - mesh.userData.keep = true: left as a normal mesh (for example the staff gem, whose world position is read).
import * as THREE from "three";

export interface Baked {
  meshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  /** The Lambert material of a vertex-coloured bucket ("main" by default), for emissive flashes. */
  material(bucket?: string): THREE.MeshLambertMaterial | undefined;
  /** Repaint the vertices of parts whose material had userData.tag = tag. */
  recolor(tag: string, color: THREE.ColorRepresentation): void;
  /** Blend a vertex-coloured bucket toward its own grey (k = 0 original, 1 grey). */
  desaturate(bucket: string, k: number, tint?: THREE.Color): void;
  dispose(): void;
}

interface Acc {
  pos: number[]; nor: number[]; col: number[]; idx: number[];
  material: THREE.Material;
  vc: boolean;
  tags: Map<string, [number, number][]>; // vertex ranges
}

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _c = new THREE.Color();

/**
 * Bake every mesh under host (except userData.keep) into skinned buckets bound to the Bones in the subtree.
 * host must be at its build-time transform (normally identity); every baked mesh needs a Bone ancestor.
 */
export function bakeRigid(host: THREE.Object3D, opts: { castShadow?: boolean } = {}): Baked {
  host.updateMatrixWorld(true);
  _inv.copy(host.matrixWorld).invert();

  const bones: THREE.Bone[] = [];
  host.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
  const boneIndex = new Map<THREE.Object3D, number>();
  bones.forEach((b, i) => boneIndex.set(b, i));

  const accs = new Map<string, Acc>();
  const created: THREE.Material[] = [];
  const victims: THREE.Mesh[] = [];

  host.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.userData.keep) return;
    if (Array.isArray(mesh.material)) return;
    let p: THREE.Object3D | null = mesh.parent;
    while (p && !boneIndex.has(p)) p = p.parent;
    if (!p) return; // not under a bone: leave it alone
    const bi = boneIndex.get(p)!;
    const m = mesh.material as THREE.MeshLambertMaterial;
    const own = m.userData.bake === "own";
    const key = own ? `own:${m.uuid}` : `vc:${m.userData.bucket ?? "main"}`;
    let acc = accs.get(key);
    if (!acc) {
      let material: THREE.Material = m;
      if (!own) {
        const lm = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
        if (m.userData.bucket === "cloth" || m.side === THREE.DoubleSide) lm.side = THREE.DoubleSide;
        created.push(lm);
        material = lm;
      }
      accs.set(key, (acc = { pos: [], nor: [], col: [], idx: [], material, vc: !own, tags: new Map() }));
    }
    if (!own && m.side === THREE.DoubleSide) acc.material.side = THREE.DoubleSide;

    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pa = src.getAttribute("position") as THREE.BufferAttribute;
    if (!src.getAttribute("normal")) src.computeVertexNormals();
    const na = src.getAttribute("normal") as THREE.BufferAttribute;
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(_m);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const start = acc.pos.length / 3;
    _c.copy(m.color ?? _c.set(1, 1, 1));
    // Flip winding if the transform mirrors (negative determinant), so faces stay front-facing.
    const flip = _m.determinant() < 0;
    for (let i = 0; i < pa.count; i++) {
      const j = flip ? i - (i % 3) + (2 - (i % 3)) : i;
      v.fromBufferAttribute(pa, j).applyMatrix4(_m);
      n.fromBufferAttribute(na, j).applyMatrix3(nm).normalize();
      acc.pos.push(v.x, v.y, v.z);
      acc.nor.push(n.x, n.y, n.z);
      acc.col.push(_c.r, _c.g, _c.b);
      acc.idx.push(bi);
    }
    if (src !== mesh.geometry) src.dispose();
    const tag = m.userData.tag as string | undefined;
    if (tag) {
      let r = acc.tags.get(tag);
      if (!r) acc.tags.set(tag, (r = []));
      r.push([start, pa.count]);
    }
    victims.push(mesh);
  });

  for (const mesh of victims) {
    mesh.parent?.remove(mesh);
    if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
  }

  const skeleton = new THREE.Skeleton(bones);
  const meshes: THREE.SkinnedMesh[] = [];
  const byBucket = new Map<string, { mesh: THREE.SkinnedMesh; acc: Acc; orig: Float32Array }>();
  for (const [key, acc] of accs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(acc.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(acc.nor, 3));
    if (acc.vc) g.setAttribute("color", new THREE.Float32BufferAttribute(acc.col, 3));
    const count = acc.idx.length;
    const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) { si[i * 4] = acc.idx[i]; sw[i * 4] = 1; }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    g.computeBoundingSphere();
    const sm = new THREE.SkinnedMesh(g, acc.material);
    sm.name = `baked:${key}`;
    sm.castShadow = opts.castShadow ?? true;
    sm.receiveShadow = true;
    sm.frustumCulled = false; // bounds move with the bones; units and camps are small
    host.add(sm);
    meshes.push(sm);
    if (acc.vc) byBucket.set(key.slice(3), { mesh: sm, acc, orig: new Float32Array(acc.col) });
  }
  host.updateMatrixWorld(true);
  for (const sm of meshes) sm.bind(skeleton, sm.matrixWorld);

  const grey = new THREE.Color();
  return {
    meshes,
    skeleton,
    material: (bucket = "main") => byBucket.get(bucket)?.mesh.material as THREE.MeshLambertMaterial | undefined,
    recolor(tag, color) {
      _c.set(color);
      for (const { mesh, acc, orig } of byBucket.values()) {
        const ranges = acc.tags.get(tag);
        if (!ranges) continue;
        const attr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
        for (const [s, n] of ranges) for (let i = s; i < s + n; i++) {
          attr.setXYZ(i, _c.r, _c.g, _c.b);
          orig[i * 3] = _c.r; orig[i * 3 + 1] = _c.g; orig[i * 3 + 2] = _c.b;
        }
        attr.needsUpdate = true;
      }
    },
    desaturate(bucket, k, tint) {
      const b = byBucket.get(bucket);
      if (!b) return;
      const attr = b.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const r = b.orig[i], g = b.orig[i + 1], bl = b.orig[i + 2];
        const l = 0.3 * r + 0.55 * g + 0.15 * bl;
        grey.setRGB(l, l, l);
        if (tint) grey.multiply(tint);
        arr[i] = r + (grey.r - r) * k;
        arr[i + 1] = g + (grey.g - g) * k;
        arr[i + 2] = bl + (grey.b - bl) * k;
      }
      attr.needsUpdate = true;
    },
    dispose() {
      for (const sm of meshes) sm.geometry.dispose();
      for (const m of created) m.dispose();
      skeleton.dispose();
    },
  };
}

// ---------- outline ----------

const outlineUniforms = {
  uOutlinePx: { value: 1.6 },
  uOutlineRes: { value: new THREE.Vector2(1920, 1080) },
};
let outlineMat: THREE.MeshBasicMaterial | null = null;
const _size = new THREE.Vector2();

/** One shared back-face material that pushes vertices out along their smoothed normal by a constant pixel width. */
function getOutlineMaterial() {
  if (outlineMat) return outlineMat;
  const m = new THREE.MeshBasicMaterial({ color: "#1b130c", side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, outlineUniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uOutlinePx;\nuniform vec2 uOutlineRes;")
      .replace("#include <project_vertex>", `#include <project_vertex>
      {
        vec3 on = normalize( transformedNormal );
        #ifdef FLIP_SIDED
          on = -on; // three flips normals for back-side materials; the hull must grow outward
        #endif
        vec4 cn = projectionMatrix * vec4( on, 0.0 );
        float l = length( cn.xy );
        if ( l > 1e-5 ) gl_Position.xy += ( cn.xy / l ) * uOutlinePx * 2.0 / uOutlineRes * gl_Position.w;
      }`);
  };
  m.customProgramCacheKey = () => "raid-art-outline";
  outlineMat = m;
  return m;
}

/**
 * Add a dark screen-space outline hull (one extra draw) around the vertex-coloured buckets of a bake.
 * Needs skinning (transformedNormal is only computed for skinned meshes in MeshBasicMaterial).
 */
export function addOutline(host: THREE.Object3D, baked: Baked, px = 1.6) {
  outlineUniforms.uOutlinePx.value = px;
  const pos: number[] = [], idx: number[] = [];
  for (const sm of baked.meshes) {
    if (!sm.geometry.getAttribute("color")) continue; // glows and gems stay un-outlined
    const pa = sm.geometry.getAttribute("position") as THREE.BufferAttribute;
    const si = sm.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); idx.push(si.getX(i)); }
  }
  if (!pos.length) return null;
  // Smoothed normals per (bone, position) so the hull does not split at hard edges.
  const n = pos.length / 3;
  const faceN = new Float32Array(pos.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromArray(pos, i * 3); b.fromArray(pos, i * 3 + 3); c.fromArray(pos, i * 3 + 6);
    c.sub(b); b.sub(a); b.cross(c); // area-weighted face normal
    for (let k = 0; k < 3; k++) faceN.set([b.x, b.y, b.z], (i + k) * 3);
  }
  const sum = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${idx[i]}|${Math.round(pos[i * 3] * 2000)}|${Math.round(pos[i * 3 + 1] * 2000)}|${Math.round(pos[i * 3 + 2] * 2000)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let v = sum.get(k);
    if (!v) sum.set(k, (v = new THREE.Vector3()));
    v.x += faceN[i * 3]; v.y += faceN[i * 3 + 1]; v.z += faceN[i * 3 + 2];
  }
  const nor = new Float32Array(pos.length);
  for (let i = 0; i < n; i++) {
    const v = sum.get(key(i))!;
    const l = v.length() || 1;
    nor[i * 3] = v.x / l; nor[i * 3 + 1] = v.y / l; nor[i * 3 + 2] = v.z / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = idx[i]; sw[i * 4] = 1; }
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
  const sm = new THREE.SkinnedMesh(g, getOutlineMaterial());
  sm.name = "baked:outline";
  sm.frustumCulled = false;
  sm.castShadow = false;
  sm.receiveShadow = false;
  sm.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(_size);
    outlineUniforms.uOutlineRes.value.copy(_size);
    outlineUniforms.uOutlinePx.value = px * renderer.getPixelRatio();
  };
  host.add(sm);
  host.updateMatrixWorld(true);
  sm.bind(baked.skeleton, sm.matrixWorld);
  return sm;
}
