// Scene entry: the Three.js isometric world. mountScene(el, store, bus) builds it from the store,
// reconciles meshes by id on every change, and turns clicks into bus selection and core commands.
import * as THREE from "three";
import { commandTarget, commandUnit, type Bus, type Store, type State, type HoverRef } from "../core";
import { IsoCamera, MAP_SIZE } from "./camera";
import { buildTerrain, layoutKey, makeRouter, zoneGate } from "./terrain";
import { buildZones, ZONE_LABEL_H, zoneColor } from "./zones";
import { buildBuilding, type BuildingView } from "./buildings";
import { UnitView, setFootprints, setRouter } from "./units";
import { TargetView } from "./targets";
import { Fx, type FxApi } from "./fx";
import { ArtFx, lighting, makeWorld, type WorldArt } from "../../../../packages/art/src";
import { artOn } from "./art";
import { WorkflowLayer } from "./workflow";
import { ArrowLayer } from "./arrows";
import { disposeTree, hash, makeEngraved, tileToWorld } from "./util";

export function mountScene(el: HTMLElement, store: Store, bus: Bus) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // projector laptops
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#2c3d1e");
  const iso = new IsoCamera();

  // Lighting: warm sun from the south-west, sky fill; or the packages/art rig behind the flag.
  const rig = artOn("lighting") ? lighting(scene, renderer, { mapSize: MAP_SIZE }) : null;
  if (!rig) {
    scene.add(new THREE.HemisphereLight("#fff3d6", "#4a6630", 1.4));
    const sun = new THREE.DirectionalLight("#fff0cf", 2.4);
    sun.position.set(MAP_SIZE / 2 - 10, 20, MAP_SIZE / 2 + 6);
    sun.target.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 60;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
  }

  // Layers of the world
  const world = new THREE.Group();
  const unitsG = new THREE.Group();
  const targetsG = new THREE.Group();
  const buildingsG = new THREE.Group();
  const fx: FxApi = artOn("fx") ? artFx() : new Fx();
  const arrows = new ArrowLayer();
  const flow = new WorkflowLayer();
  scene.add(world, buildingsG, targetsG, unitsG, arrows.group, flow.group, fx.group);

  const units = new Map<string, UnitView>();
  const targets = new Map<string, TargetView>();
  const buildings = new Map<string, BuildingView>();
  let layout = "";
  let artWorld: WorldArt | null = null; // packages/art terrain, zones and props (flag 'terrain')
  let userCamera = false; // once the user pans or zooms, stop auto framing
  const justSpawned = new Set<string>(); // ids from unit.spawned events, consumed by reconcile
  const spawnedTargets = new Set<string>(); // ids from target.spawned events: the camp rises out of a portal

  // ---- reconcile store -> meshes ----
  function teamColor(s: State, team: number | null) {
    return team == null ? null : s.teams.find((t) => t.id === team)?.color ?? null;
  }

  function reconcile(s: State) {
    const key = layoutKey(s.components, s.buildings);
    if (key !== layout) {
      layout = key;
      for (const c of [...world.children]) { if (c !== artWorld?.object3d) disposeTree(c); world.remove(c); }
      artWorld?.dispose();
      artWorld = null;
      if (artOn("terrain")) {
        artWorld = buildArtWorld(s, key);
        world.add(artWorld.object3d);
        s.components.forEach((c) => {
          const label = makeEngraved(c.name, ZONE_LABEL_H);
          label.position.set(c.zone.x + c.zone.w / 2, 0.55, c.zone.y + 0.1);
          world.add(label);
        });
      } else {
        world.add(buildTerrain(s.components, s.buildings, s.targets), buildZones(s.components, s.buildings));
      }
      setRouter(makeRouter(s.components, s.buildings));
      setFootprints(s.buildings.map((b) => ({ x: b.x, y: b.y })));
      for (const b of buildings.values()) { buildingsG.remove(b.group); b.dispose(); disposeTree(b.group); }
      buildings.clear();
      for (const b of s.buildings) {
        const v = buildBuilding(b);
        buildings.set(b.id, v);
        buildingsG.add(v.group);
      }
      if (!userCamera) frameContent(); // first real layout (or a new one) before the user moved the camera
    }

    const seenT = new Set<string>();
    for (const t of s.targets) {
      seenT.add(t.id);
      let v = targets.get(t.id);
      if (!v) {
        v = new TargetView(t);
        targets.set(t.id, v);
        targetsG.add(v.group);
        if (spawnedTargets.delete(t.id)) {
          const p = v.group.position.clone();
          v.rise();
          fx.portal(p);
          fx.after(0.9, () => fx.text(p.clone().setY(1.5), `New issue ${t.issue}`, { color: "#f0dcff", bg: null, height: 0.34, dur: 2.4 }));
        }
      }
      else {
        const was = v.target.status;
        v.update(t);
        if (was !== "resolved" && t.status === "resolved") {
          const p = v.group.position.clone().setY(0.3);
          fx.burst(p, "#9dff7a", 2.0, 1.0);
          fx.after(0.25, () => fx.burst(p, "#ffd45a", 1.4, 0.8));
          fx.text(p.clone().setY(1.2), `Resolved ${t.issue}`, { height: 0.3, dur: 3 });
          for (const o of s.orders) if (o.targetId === t.id && o.status !== "proposed") units.get(o.unitId)?.celebrate();
        }
      }
    }
    for (const [id, v] of targets) if (!seenT.has(id)) { targetsG.remove(v.group); v.dispose(); targets.delete(id); }

    const seenU = new Set<string>();
    for (const u of s.units) {
      seenU.add(u.id);
      const color = teamColor(s, u.team);
      let v = units.get(u.id);
      if (!v) {
        // Units that appear after the first load walk out of the Forge (forged types) or the Barracks.
        let from: THREE.Vector3 | undefined;
        if (justSpawned.has(u.id)) {
          const forged = s.unitTypes.some((t) => t.id === u.class && t.source === "forge");
          const home = [...buildings.values()].find((b) => b.kind === (forged ? "river" : "barracks"));
          if (home) {
            from = home.door.clone();
            home.pulse();
            fx.burst(home.door.clone().setY(0.1), forged ? "#ff9a3c" : "#f2e27a", 1.2, 0.8);
          }
        }
        v = new UnitView(u, color, from);
        const uv = v;
        v.onStrike = (p) => {
          fx.sparksAt(p);
          const o = uv.unit.orderId ? store.getState().orders.find((x) => x.id === uv.unit.orderId) : undefined;
          if (o) targets.get(o.targetId)?.hit(); // art camps flinch
        };
        units.set(u.id, v);
        unitsG.add(v.group);
      }
      else v.update(u, color);
      // Face the target of the current order while working
      const order = u.orderId ? s.orders.find((o) => o.id === u.orderId) : undefined;
      const tgt = order ? s.targets.find((t) => t.id === order.targetId) : undefined;
      v.faceTo = tgt ? tileToWorld(tgt.pos.x, tgt.pos.y) : null;
    }
    for (const [id, v] of units) {
      if (seenU.has(id)) continue;
      fx.burst(v.group.position.clone().setY(0.2), "#cfc8b8", 0.9, 0.6); // retired
      unitsG.remove(v.group);
      v.dispose();
      units.delete(id);
    }

    // Forge at work while a forged type is generating, training or evaluating
    const busy = s.unitTypes.filter((t) => t.source === "forge" && (t.status === "generating" || t.status === "training" || t.status === "evaluating"));
    for (const b of buildings.values()) {
      if (b.kind !== "river") continue;
      if (!busy.length) b.setWork(null);
      else {
        const t = busy[0];
        b.setWork(t.progress ?? 0, `${t.name}: ${t.stage || t.status}${busy.length > 1 ? ` (+${busy.length - 1})` : ""}`);
      }
    }
    forgeBusy = busy.length > 0;
    justSpawned.clear();
    syncSelection();
  }
  let forgeBusy = false;
  let forgeSparkT = 0;

  function syncArrows() {
    const s = store.getState();
    arrows.sync(s, new Set(bus.selection.units), (team) => teamColor(s, team));
  }

  function syncSelection() {
    const sel = bus.selection;
    const hov = bus.hovered;
    const selUnits = new Set(sel.units);
    for (const [id, v] of units) {
      v.setSelected(selUnits.has(id));
      v.setHovered(hov?.kind === "unit" && hov.id === id);
    }
    for (const [id, v] of targets) {
      v.setSelected(sel.target === id);
      v.setHovered(hov?.kind === "target" && hov.id === id);
    }
    for (const [id, v] of buildings) {
      v.setSelected(sel.building === id);
      v.setHovered(hov?.kind === "building" && hov.id === id);
    }
  }

  reconcile(store.getState());
  const offs: (() => void)[] = [];
  syncArrows();
  flow.sync(store.getState());
  offs.push(store.subscribe((s) => { reconcile(s); syncArrows(); flow.sync(s); }));
  offs.push(bus.on("selection", () => { syncSelection(); syncArrows(); }));
  offs.push(bus.on("hover", () => syncSelection()));
  offs.push(bus.on("focusTile", ({ x, y }) => { userCamera = true; iso.focus(x + 0.5, y + 0.5); }));
  offs.push(store.onEvent((ev) => {
    if (ev.type === "memory.recall") recallFx(ev.unitId, ev.slugs ?? [], ev.summary);
    else if (ev.type === "memory.remember") rememberFx(ev.unitId, ev.slug, ev.summary);
    else if (ev.type === "unit.spawned") justSpawned.add(ev.unit.id); // reconcile walks it out of its building
    else if (ev.type === "target.spawned") spawnedTargets.add(ev.target.id);
    else if (ev.type === "workflow.handoff") handoffFx(ev.fromUnitId, ev.toUnitId, ev.summary);
  }));

  // ---- GBrain memory animations ----
  const library = () => [...buildings.values()].find((b) => b.kind === "gbrain");
  const libOrb = () => {
    const lib = library();
    return lib ? lib.anchor.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(11.5, 3.4, 11.5);
  };
  const shortSlug = (s: string) => (s.length > 34 ? s.slice(0, 33) + "\u2026" : s);
  /** Page title for a brain slug (look-plan: never show raw slugs): learnings/lum-101-u3-<ms> -> "Learning LUM-101". */
  const slugTitle = (slug: string) => {
    const leaf = slug.split("/").pop() ?? slug;
    const learning = /^([a-z]+-\d+)-u\w*-\d{9,}$/i.exec(leaf);
    if (learning) return `Learning ${learning[1].toUpperCase()}`;
    if (/^[a-z]+-\d+$/i.test(leaf)) return leaf.toUpperCase();
    const words = leaf.replace(/[-_]+/g, " ").trim();
    return shortSlug(words.charAt(0).toUpperCase() + words.slice(1));
  };

  /** Recall: blue beam from the Library to the unit's staff, pages fly down to it. */
  function recallFx(unitId: string, slugs: string[], summary: string) {
    const v = units.get(unitId);
    if (!v) return;
    const tip = () => v.staffTip();
    v.flashRaise("recall");
    if (fx.recallBeam) fx.recallBeam(libOrb, tip, { ground: 0 });
    else fx.beam(libOrb, tip, "#4aa3ff", 2.4, 0.13);
    const n = Math.max(1, Math.min(3, slugs.length));
    for (let i = 0; i < n; i++) {
      fx.page(libOrb, tip, 0.15 + i * 0.3, i === 0 ? () => fx.burst(tip(), "#6fb6ff", 0.9, 0.6) : undefined);
    }
    const label = slugs[0] ? slugTitle(slugs[0]) + (slugs.length > 1 ? ` +${slugs.length - 1}` : "") : shortSlug(summary || "Recall");
    fx.after(0.9, () => fx.text(() => tip().add(new THREE.Vector3(0, 0.35, 0)), label, { color: "#dcefff", bg: null, height: 0.26, dur: 2.6 }));
  }

  /** Remember: a gold orb flies from the unit into the Library, which pulses; the page count ticks. */
  function rememberFx(unitId: string, slug: string, _summary: string) {
    const v = units.get(unitId);
    const lib = library();
    if (!v) { lib?.pulse(); return; }
    v.flashRaise("remember");
    const from = v.staffTip();
    fx.burst(from, "#ffc94a", 0.6, 0.5);
    fx.orb(from, libOrb, () => {
      lib?.pulse();
      fx.burst(libOrb(), "#ffd45a", 2.2, 1.0);
      fx.text(() => libOrb().add(new THREE.Vector3(0, 0.4, 0)), "+1 page", { color: "#ffe9a8", bg: null, height: 0.34, dur: 2 });
      if (slug) fx.text(() => libOrb().add(new THREE.Vector3(0, 0.85, 0)), slugTitle(slug), { color: "#fff6d8", bg: null, height: 0.24, dur: 2.4 });
    });
  }

  /** Workflow handoff: a scroll flies from the giver to the receiver, then the summary floats over the receiver. */
  function handoffFx(fromId: string, toId: string, summary: string) {
    const a = units.get(fromId), b = units.get(toId);
    if (!a || !b) return;
    const s = store.getState();
    const color = teamColor(s, b.unit.team) ?? "#ffd45a";
    const head = (v: UnitView) => () => v.group.position.clone().setY(1.25);
    a.flashRaise("remember", 0.9);
    fx.burst(head(a)(), color, 0.6, 0.5);
    fx.scroll(head(a), head(b), { color }, () => {
      b.flashRaise("recall", 0.9);
      fx.burst(head(b)(), color, 0.9, 0.6);
      const text = bubbleText(summary, a.unit.name);
      if (text) fx.text(() => head(b)().add(new THREE.Vector3(0, 0.55, 0)), text, { height: 0.3, dur: 4 });
    });
  }

  /** Immediate feedback for an order: target flashes, a ring pulses in the team colour of the ordering units. */
  function orderPing(targetId: string) {
    const tv = targets.get(targetId);
    if (!tv) return;
    tv.orderFlash();
    const s = store.getState();
    const first = s.units.find((u) => u.id === bus.selection.units[0]);
    const color = teamColor(s, first?.team ?? null) ?? "#9dff7a";
    const p = tv.group.position.clone().setY(0.12);
    if (fx.orderPing) { fx.orderPing(p, color); return; }
    fx.burst(p, color, 1.6, 0.7);
    fx.after(0.18, () => fx.burst(p, color, 1.1, 0.6));
  }

  // ---- picking ----
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickRoots = [unitsG, targetsG, buildingsG];

  function toNdc(e: { clientX: number; clientY: number }) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    return ndc;
  }

  function pick(e: { clientX: number; clientY: number }): HoverRef {
    ray.setFromCamera(toNdc(e), iso.camera);
    const hits = ray.intersectObjects(pickRoots, true);
    // Prefer units over targets over buildings when overlapping
    let best: HoverRef = null;
    let bestRank = 9;
    const rank = { unit: 0, target: 1, building: 2, tile: 3 } as const;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData?.kind) o = o.parent;
      const kind = o?.userData?.kind as keyof typeof rank | undefined;
      if (!o || !kind || !(kind in rank)) continue;
      if (rank[kind] < bestRank) { bestRank = rank[kind]; best = { kind, id: o.userData.id }; }
      if (bestRank === 0) break;
    }
    return best;
  }

  // ---- input: click select, left-drag box select, right/middle (or space/alt + left) drag pans, wheel zooms ----
  const canvas = renderer.domElement;
  let down: { x: number; y: number; button: number; dragging: boolean; mode: "box" | "pan" } | null = null;
  const DRAG_PX = 5;
  let spaceHeld = false;
  const box = document.createElement("div");
  box.style.cssText = "position:absolute;display:none;pointer-events:none;border:1px solid #f4f0c0;" +
    "background:rgba(220,255,160,0.12);box-shadow:0 0 0 1px rgba(0,0,0,0.35);z-index:1";
  el.appendChild(box);

  function drawBox(x0: number, y0: number, x1: number, y1: number) {
    const r = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = `${Math.min(x0, x1) - r.left}px`;
    box.style.top = `${Math.min(y0, y1) - r.top}px`;
    box.style.width = `${Math.abs(x1 - x0)}px`;
    box.style.height = `${Math.abs(y1 - y0)}px`;
  }

  /** Units whose body projects inside the client-space rectangle. */
  function unitsInBox(x0: number, y0: number, x1: number, y1: number) {
    const r = canvas.getBoundingClientRect();
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const v = new THREE.Vector3();
    const ids: string[] = [];
    for (const [id, u] of units) {
      v.copy(u.group.position).setY(0.45).project(iso.camera);
      const sx = ((v.x + 1) / 2) * r.width + r.left, sy = ((1 - v.y) / 2) * r.height + r.top;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) ids.push(id);
    }
    return ids;
  }

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointerdown", (e) => {
    const pan = e.button !== 0 || spaceHeld || e.altKey;
    down = { x: e.clientX, y: e.clientY, button: e.button, dragging: false, mode: pan ? "pan" : "box" };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.dragging && Math.hypot(dx, dy) > DRAG_PX) down.dragging = true;
      if (down.dragging) {
        if (down.mode === "pan") {
          userCamera = true;
          iso.panPixels(e.movementX, e.movementY);
          canvas.style.cursor = "grabbing";
        } else {
          drawBox(down.x, down.y, e.clientX, e.clientY);
        }
      }
      return;
    }
    pendingHover = { clientX: e.clientX, clientY: e.clientY };
  });
  canvas.addEventListener("pointercancel", () => { down = null; box.style.display = "none"; canvas.style.cursor = ""; });
  canvas.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    canvas.style.cursor = "";
    box.style.display = "none";
    if (d?.dragging && d.mode === "box") {
      const ids = unitsInBox(d.x, d.y, e.clientX, e.clientY);
      if (ids.length) bus.select(ids, { add: e.shiftKey });
      else if (!e.shiftKey && !bus.command) bus.clear();
      return;
    }
    if (!d || d.dragging) return;
    const hit = pick(e);
    if (d.button === 2) {
      if (hit?.kind === "target" && (bus.selection.units.length || bus.command)) orderPing(hit.id);
      if (hit?.kind === "target") void commandTarget(store, bus, hit.id);
      else if (!hit && bus.selection.units.length) {
        // No move orders in this game: a red ping says "pick an enemy camp".
        const g = iso.groundAt(toNdc(e));
        if (g) {
          if (fx.orderPing) fx.orderPing(g.setY(0.05), "#ff5a4a", 0.7);
          else fx.burst(g.setY(0.05), "#ff5a4a", 0.7, 0.45);
        }
      }
      return;
    }
    if (d.button !== 0) return;
    if (!hit) { if (!bus.command) bus.clear(); return; }
    if (hit.kind === "unit") {
      if (commandUnit(bus, hit.id)) return;
      bus.select([hit.id], { add: e.shiftKey });
    } else if (hit.kind === "target") {
      if (bus.command) { orderPing(hit.id); void commandTarget(store, bus, hit.id); }
      else bus.selectTarget(hit.id);
    } else if (hit.kind === "building") {
      bus.selectBuilding(hit.id);
    }
  });
  canvas.addEventListener("dblclick", (e) => {
    // Double-click a unit: select its whole team. Double-click a camp: select the units working it.
    const hit = pick(e);
    if (hit?.kind === "target") {
      const s = store.getState();
      const ids = s.orders.filter((o) => o.targetId === hit.id && o.status === "active").map((o) => o.unitId);
      if (ids.length) bus.select(ids);
      return;
    }
    if (hit?.kind !== "unit") return;
    const u = store.getState().units.find((x) => x.id === hit.id);
    if (u?.team == null) return;
    bus.select(store.getState().units.filter((x) => x.team === u.team).map((x) => x.id));
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = e.ctrlKey ? 0.012 : 0.0016; // pinch vs wheel
    userCamera = true;
    iso.zoomAt(Math.exp(-e.deltaY * k), toNdc(e));
  }, { passive: false });
  canvas.addEventListener("pointerleave", () => { pendingHover = null; if (bus.hovered) bus.hover(null); });

  let pendingHover: { clientX: number; clientY: number } | null = null;
  function applyHover() {
    if (!pendingHover) return;
    const h = pick(pendingHover);
    pendingHover = null;
    const cur = bus.hovered;
    if (h?.kind !== cur?.kind || h?.id !== cur?.id) bus.hover(h);
    canvas.style.cursor = h ? (h.kind === "target" && (bus.selection.units.length || bus.command) ? "crosshair" : "pointer") : "";
  }

  // Keyboard camera: WASD and arrows (core owns 1..9 and Esc).
  const keys = new Set<string>();
  const typing = (t: EventTarget | null) => {
    const n = t as HTMLElement | null;
    return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") spaceHeld = true;
    const k = e.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      keys.add(k);
      e.preventDefault();
    } else if (k === "h") {
      const lib = store.getState().buildings.find((b) => b.kind === "gbrain");
      if (lib) { userCamera = true; iso.focus(lib.x + 0.5, lib.y + 0.5); }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.key.toLowerCase());
    if (e.code === "Space") spaceHeld = false;
  };
  const onBlur = () => { keys.clear(); spaceHeld = false; };
  const onFocusIn = (e: FocusEvent) => { if (typing(e.target)) { keys.clear(); spaceHeld = false; } };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp, true); // capture: HUD inputs may stop propagation
  window.addEventListener("blur", onBlur);
  window.addEventListener("focusin", onFocusIn, true);

  // ---- resize and loop ----
  function resize() {
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    iso.resize(w, h);
    if (!userCamera) frameContent();
  }
  /** Initial framing: fit zones, buildings, targets and units into the part of the canvas the HUD leaves free. */
  function frameContent() {
    const s = store.getState();
    const pts: THREE.Vector3[] = [];
    const box = (x0: number, z0: number, x1: number, z1: number, h: number) => {
      for (const x of [x0, x1]) for (const z of [z0, z1]) pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z));
    };
    for (const c of s.components) box(c.zone.x, c.zone.y, c.zone.x + c.zone.w, c.zone.y + c.zone.h, 1.1);
    for (const b of s.buildings) box(b.x - 1.3, b.y - 1.3, b.x + 2.3, b.y + 2.3, b.kind === "gbrain" ? 3.9 : 2.6);
    for (const t of s.targets) box(t.pos.x, t.pos.y, t.pos.x + 1, t.pos.y + 1, 1.4);
    for (const u of s.units) box(u.pos.x, u.pos.y, u.pos.x + 1, u.pos.y + 1, 1.6);
    iso.fitMap(pts, hudInsets());
  }
  function hudInsets() {
    // Resolve the HUD layout variables (hud.css :root) to pixels with a hidden probe; 0 when absent.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;height:var(--hud-top,0px);width:var(--hud-bottom,0px)";
    el.appendChild(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    const pad = 14;
    return { top: r.height + pad, bottom: r.width + pad, left: pad, right: pad };
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const clock = new THREE.Clock();
  let raf = 0;
  let viewVersion = -1; // last camera version sent to the minimap
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    if (keys.size) {
      const sp = 14 * dt;
      const r = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      const u = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      if (r || u) { userCamera = true; iso.panScreen(r * sp, u * sp * 0.5); }
    }
    applyHover();
    if (iso.version !== viewVersion) {
      viewVersion = iso.version;
      rig?.follow(iso.target);
      bus.emit("view", { corners: iso.viewCorners() }); // minimap view frame, at most once per frame
    }
    artWorld?.tick(t, dt);
    for (const v of units.values()) v.tick(t, dt);
    for (const v of targets.values()) v.tick(t, dt);
    for (const v of buildings.values()) v.tick(t, dt);
    arrows.tick(t, units, targets);
    flow.tick(t, units);
    if (forgeBusy && (forgeSparkT -= dt) <= 0) {
      forgeSparkT = 0.12;
      for (const b of buildings.values()) if (b.kind === "river") {
        if (fx.forgeSparks) fx.forgeSparks(b.top, 0.4);
        else fx.sparksAt(b.top, 3, "#ff9a3c");
      }
    }
    TargetView.detail = iso.camera.zoom >= 1.3;
    fx.tick(dt);
    rig?.update();
    renderer.render(scene, iso.camera);
  }
  frame();

  // Debug handle for review: raid.scene.units, raid.scene.camera
  (window as any).raidScene = { scene, iso, units, targets, buildings, renderer, fx, recallFx, rememberFx, handoffFx, flow };

  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((f) => f());
    ro.disconnect();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focusin", onFocusIn, true);
    for (const v of units.values()) v.dispose();
    for (const v of targets.values()) v.dispose();
    for (const b of buildings.values()) { b.dispose(); disposeTree(b.group); }
    renderer.dispose();
    canvas.remove();
    box.remove();
  };
}

/** packages/art effects behind the flag, adapted to the scene's FxApi (orb maps to rememberOrb). */
/** Handoff summary as a short bubble (look-plan): no "Ada:" prefix, first clause only, 8 words max. */
function bubbleText(summary: string, giver: string) {
  let text = summary.replace(/\s+/g, " ").trim();
  text = text.startsWith(giver + ": ") ? text.slice(giver.length + 2) : text.replace(/^[A-Z][\w'-]*( [A-Z][\w'-]*)?: /, "");
  const clause = text.split(/[.:;!?](?:\s|$)/)[0].trim() || text;
  const words = clause.split(" ");
  const out = words.slice(0, 8).join(" ") + (words.length > 8 ? "\u2026" : "");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function artFx(): FxApi {
  const a = new ArtFx();
  return {
    group: a.group,
    tick: (dt) => a.tick(dt),
    beam: (from, to, color, dur, width) => { a.beam(from, to, color, dur, width); },
    page: (from, to, delay, onArrive) => { a.page(from, to, delay, onArrive); },
    orb: (from, to, onArrive) => { a.rememberOrb(from, to, onArrive); },
    burst: (p, color, size, dur) => { a.burst(p, color, size, dur); },
    text: (p, text, opts) => { a.text(p, text, opts); },
    sparksAt: (p, n, color) => { a.sparksAt(p, n, color); },
    after: (delay, fn) => { a.after(delay, fn); },
    scroll: (from, to, opts, onArrive) => { a.scroll(from, to, opts, onArrive); },
    portal: (p, color, dur) => { a.portal(p, color, dur); },
    recallBeam: (from, to, opts) => { a.recallBeam(from, to, opts); },
    orderPing: (p, color, size) => { a.orderPing(p, color, size); },
    flag: (p, color, opts) => { a.flag(p, color, opts); },
    forgeSparks: (p, intensity) => { a.forgeSparks(p, intensity); },
  };
}

/** packages/art world for the layout: roads to the Library, walled zones with gates, props, clear staging plaza. */
function buildArtWorld(s: State, key: string) {
  const lib = s.buildings.find((b) => b.kind === "gbrain") ?? { x: 11, y: 11 };
  const blocked: [number, number][] = [];
  for (const t of s.targets) blocked.push([t.pos.x, t.pos.y]);
  for (const u of s.units) blocked.push([u.pos.x, u.pos.y]);
  for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) blocked.push([lib.x + i, lib.y + j]); // idle staging plaza
  for (const b of s.buildings) for (let i = -1; i <= 1; i++) blocked.push([b.x + i, b.y + 2]); // door rows
  return makeWorld({
    size: MAP_SIZE,
    seed: hash(key),
    library: { x: lib.x, y: lib.y },
    buildings: s.buildings.filter((b) => b.kind !== "gbrain").map((b) => ({ x: b.x, y: b.y })),
    zones: s.components.map((c, i) => ({ ...c.zone, color: zoneColor(i), name: c.name, gate: zoneGate(c, lib) })),
    blocked,
  });
}
