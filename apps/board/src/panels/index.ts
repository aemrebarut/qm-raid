// Building panels: slate overlays for the Library (GBrain) and the Forge (River), shown while
// bus.selection.building is "library" or "forge" (matched by building kind). Esc or Close clears.
// Both cover the side panel area, so the building is not described twice on screen.
import type { Store, Bus } from "../core";
import { icon } from "../theme/icons";
import "../theme/tokens.css";
import { h } from "./el";
import { LibraryPanel } from "./library";
import { ForgePanel } from "./forge";
import "./panels.css";

export function mountPanels(el: HTMLElement, store: Store, bus: Bus): () => void {
  const library = new LibraryPanel(store, bus);
  const forge = new ForgePanel(store, bus);
  const crest = h("span", { class: "pnl-crest" });
  const title = h("h2", {});
  const mark = h("span", { class: "pnl-mark" });
  const extra = h("div", { class: "pnl-head-extra" });
  const body = h("div", { class: "pnl-slot" });
  const root = h("div", { class: "pnl-overlay", hidden: true },
    h("div", { class: "pnl-head" }, crest, title, mark, extra,
      h("button", { class: "pnl-close", title: "Close", onclick: () => bus.clear() }, icon("close"), h("kbd", { class: "lk-key" }, "Esc"))),
    body);
  el.append(root);
  library.prefetch();

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
    if (open === "library") library.hide();
    open = next;
    root.hidden = !open;
    root.dataset.kind = open ?? "";
    // Restart the open animation.
    root.classList.remove("pnl-in"); void root.offsetWidth; if (open) root.classList.add("pnl-in");
    if (open === "library") {
      crest.replaceChildren(icon("library"));
      title.textContent = "Library";
      mark.textContent = "GBrain";
      extra.replaceChildren(library.stats);
      body.replaceChildren(library.root);
      library.show();
    } else if (open === "forge") {
      crest.replaceChildren(icon("forge"));
      title.textContent = "Forge";
      mark.textContent = "River";
      extra.replaceChildren(forge.stats);
      body.replaceChildren(forge.root);
      forge.show();
    } else { body.replaceChildren(); extra.replaceChildren(); }
  };

  let lastState = store.getState();
  const offs = [
    bus.on("openPage", (slug) => {
      const lib = store.getState().buildings.find((b) => b.kind === "gbrain")?.id ?? "library";
      if (bus.selection.building !== lib) bus.selectBuilding(lib);
      library.openPage(slug);
    }),
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
  return () => { offs.forEach((off) => off()); library.hide(); root.remove(); };
}
