// Board entry: builds the store and bus, connects to the engine, mounts scene/ and hud/.
// scene/index.ts must export mountScene(el, store, bus); hud/index.ts must export mountHud(el, store, bus).
// Both are optional at load time (import.meta.glob), so the app runs while either is still being built.
import { createStore, createBus, connectEngine, fixtureState, installKeys, linkSelection, devTools, api, type Store, type Bus } from "./core";

type Mount = (el: HTMLElement, store: Store, bus: Bus) => void | (() => void);

const scenes = import.meta.glob<{ mountScene?: Mount }>("./scene/index.ts", { eager: true });
const huds = import.meta.glob<{ mountHud?: Mount }>("./hud/index.ts", { eager: true });

const store = createStore(fixtureState());
const bus = createBus();

function mount(label: string, el: HTMLElement | null, fn: Mount | undefined) {
  if (!el) return;
  if (!fn) {
    const note = document.createElement("div");
    note.textContent = `${label} not mounted yet`;
    note.style.cssText = "position:absolute;left:8px;color:#e8d9a8;font:12px monospace;opacity:.6;" + (label === "scene" ? "top:8px" : "top:24px");
    el.appendChild(note);
    return;
  }
  try { fn(el, store, bus); } catch (err) { console.error(`[board] mount ${label} failed`, err); }
}

mount("scene", document.getElementById("scene"), Object.values(scenes)[0]?.mountScene);
mount("hud", document.getElementById("hud"), Object.values(huds)[0]?.mountHud);
connectEngine(store);
installKeys(store, bus);
linkSelection(store, bus);

// Console handle for debugging and review: raid.store.getState(), raid.bus.select(["u1"]), raid.api.state(),
// raid.dev.propose() / recall("u1") / remember("u1") inject synthetic events locally.
(window as any).raid = { store, bus, api, dev: devTools(store) };
