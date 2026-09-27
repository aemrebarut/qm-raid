// Building panels (raid-ui-plan): large parchment overlays for the Library (GBrain) and the Forge (River),
// shown while bus.selection.building is "library" or "forge" (matched by building kind). Esc or Close clears.
import type { Store, Bus } from "../core";
import { h } from "./el";
import { LibraryPanel } from "./library";
import { ForgePanel } from "./forge";
import "./panels.css";

export function mountPanels(el: HTMLElement, store: Store, bus: Bus): () => void {
  const library = new LibraryPanel(store, bus);
  const forge = new ForgePanel(store, bus);
  const title = h("h2", {});
  const sub = h("span", { class: "pnl-sub" });
  const body = h("div", { class: "pnl-slot" });
  const root = h("div", { class: "pnl-overlay", hidden: true },
    h("div", { class: "pnl-head" }, title, sub, h("span", { style: "flex:1" }),
      h("button", { class: "pnl-btn", title: "Close (Esc)", onclick: () => bus.clear() }, "Close")),
    body);
  el.append(root);

  let open: "library" | "forge" | null = null;
  const kindOf = (id: string | null) => {
    if (!id) return null;
    const b = store.getState().buildings.find((x) => x.id === id);
    const kind = b?.kind ?? id;
    return kind === "gbrain" || id === "library" ? "library" : kind === "river" || id === "forge" ? "forge" : null;
  };

  const sync = () => {
    const next = kindOf(bus.selection.building);
    if (next === open) return;
    open = next;
    root.hidden = !open;
    root.classList.toggle("pnl-compact", open === "forge");
    if (open === "library") {
      title.textContent = "The Library";
      sub.textContent = " GBrain: what the agents know and have learned";
      body.replaceChildren(library.root);
      library.show();
    } else if (open === "forge") {
      title.textContent = "The Forge";
      sub.textContent = " River: forge new kinds of agents";
      body.replaceChildren(forge.root);
      forge.show();
    } else body.replaceChildren();
  };

  let lastState = store.getState();
  const offs = [
    store.subscribe((s) => {
      if (s === lastState) return; // setState and state.snapshot replace the object; events mutate it
      lastState = s;
      library.onReset();
      if (open === "forge") forge.render();
    }),
    bus.on("selection", sync),
    store.onEvent((ev) => {
      library.onEvent(ev);
      if (open === "forge" && (ev.type === "forge.updated" || ev.type === "state.snapshot" || ev.type === "unit.spawned")) forge.render();
    }),
  ];
  sync();
  return () => { offs.forEach((off) => off()); root.remove(); };
}
