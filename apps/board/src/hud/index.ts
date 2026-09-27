// HUD entry: DOM overlays on top of the scene. Each panel is a direct child of el
// (index.html gives #hud > * pointer events; the rest of #hud lets clicks through to the scene).
import type { Bus, Store } from "../core";
import "./hud.css";
import { CommandHint, Toasts } from "./notices";
import { SidePanel } from "./sidePanel";
import { TopBar } from "./topBar";

export function mountHud(el: HTMLElement, store: Store, bus: Bus): () => void {
  const top = new TopBar();
  const side = new SidePanel(store, bus);
  const toasts = new Toasts();
  const hint = new CommandHint(bus);
  const parts = [top.root, side.root, hint.root, toasts.root];
  el.append(...parts);

  // State changes can arrive many times per frame (unit.moved); render at most once per frame.
  let queued = false;
  const render = () => {
    queued = false;
    const s = store.getState();
    top.setState(s);
    side.setState(s);
  };
  const schedule = () => {
    if (!queued) { queued = true; requestAnimationFrame(render); }
  };

  const offs = [
    store.subscribe(schedule),
    store.onConnection((c) => top.setConnection(c)),
    bus.on("selection", (sel) => side.setSelection(sel)),
    bus.on("toast", (t) => toasts.show(t.text, t.level)),
    bus.on("command", (c) => hint.set(c)),
  ];
  hint.set(bus.command);
  top.setConnection(store.connection);
  side.setSelection(bus.selection);
  render();

  return () => {
    offs.forEach((off) => off());
    parts.forEach((p) => p.remove());
  };
}
