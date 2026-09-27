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
