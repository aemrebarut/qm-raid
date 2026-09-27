// Brain page slugs as clickable chips that open the Library overlay on that page (bus.openPage).
import type { Bus } from "../core";
import { h } from "./dom";

const MAX_CHIPS = 4;

export function slugChips(slugs: string[] | undefined, bus: Bus): HTMLElement | null {
  const list = [...new Set((slugs ?? []).filter((s) => typeof s === "string" && s.length > 0))];
  if (!list.length) return null;
  const shown = list.slice(0, MAX_CHIPS);
  return h("span", { class: "hud-chips" },
    shown.map((slug) => h("button", {
      class: "hud-chip", type: "button", title: `Open ${slug} in the Library`,
      onclick: (e: Event) => { e.stopPropagation(); bus.openPage(slug); },
    }, "\u{1F4C4}", slug.split("/").pop() || slug)),
    list.length > shown.length ? h("span", { class: "hud-chip-more", title: list.slice(MAX_CHIPS).join(", ") }, `+${list.length - shown.length}`) : null,
  );
}
