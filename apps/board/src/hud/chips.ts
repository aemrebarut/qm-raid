// Brain pages as clickable chips with human titles that open the Library overlay on that page (bus.openPage).
import type { Bus } from "../core";
import { icon } from "../theme/icons";
import { pageTitle } from "../theme/text";
import { h } from "./dom";

const MAX_CHIPS = 3;

export function slugChips(slugs: string[] | undefined, bus: Bus): HTMLElement | null {
  const list = [...new Set((slugs ?? []).filter((s) => typeof s === "string" && s.length > 0))];
  if (!list.length) return null;
  const shown = list.slice(0, MAX_CHIPS);
  return h("span", { class: "hud-chips" },
    shown.map((slug) => h("button", {
      class: "hud-chip", type: "button", title: "Open in the Library",
      onclick: (e: Event) => { e.stopPropagation(); bus.openPage(slug); },
    }, icon("page"), pageTitle(slug))),
    list.length > shown.length ? h("span", { class: "hud-chip-more", title: list.slice(MAX_CHIPS).map(pageTitle).join(", ") }, `+${list.length - shown.length}`) : null,
  );
}
