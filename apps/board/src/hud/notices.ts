// Toasts (bottom centre, 3 s) and the pending-command hint ("choose a target, Esc to cancel").
import type { Bus, Command, Store } from "../core";
import { icon } from "../theme/icons";
import { h } from "./dom";

const TOAST_MS = 3000;
const MAX_TOASTS = 4;

export class Toasts {
  readonly root = h("div", { class: "hud-toasts", "aria-live": "polite" });

  show(text: string, level: "info" | "error" = "info"): void {
    const el = h("div", { class: "hud-toast hud-stone", "data-level": level }, text);
    this.root.append(el);
    while (this.root.children.length > MAX_TOASTS) this.root.firstElementChild?.remove();
    setTimeout(() => {
      el.dataset.leaving = "true";
      setTimeout(() => el.remove(), 300);
    }, TOAST_MS);
  }
}

export class CommandHint {
  private label = h("span", { class: "hud-command-label" });
  private text = h("span", { class: "hud-sub" });
  readonly root = h("div", { class: "hud-command hud-stone", hidden: true },
    icon("order"), this.label, this.text,
    h("button", { class: "hud-btn hud-btn-sm", type: "button", title: "Cancel (Esc)", onclick: () => this.bus.setCommand(null) }, "Cancel", h("span", { class: "lk-key" }, "Esc")),
  );

  constructor(private bus: Bus, private store?: Store) {}

  set(c: Command): void {
    this.root.hidden = !c;
    if (!c) return;
    if (c.kind === "role") {
      const role = this.store?.team(c.teamId)?.workflow?.nodes.find((n) => n.id === c.nodeId)?.role ?? "unit";
      this.label.textContent = "Formation";
      this.text.textContent = `Pick a ${role[0].toUpperCase()}${role.slice(1)}`;
      return;
    }
    this.label.textContent = c.kind === "adjust" ? "Adjust" : "Order";
    this.text.textContent = c.kind === "adjust" ? "Pick a camp or unit" : "Pick a camp";
  }
}
