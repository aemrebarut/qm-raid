// Toasts (bottom centre, 3 s) and the pending-command hint ("choose a target, Esc to cancel").
import type { Bus, Command } from "../core";
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
  private text = h("span");
  readonly root = h("div", { class: "hud-command hud-stone", hidden: true },
    this.text,
    h("button", { class: "hud-btn hud-btn-sm", type: "button", onclick: () => this.bus.setCommand(null) }, "Cancel"),
  );

  constructor(private bus: Bus) {}

  set(c: Command): void {
    this.root.hidden = !c;
    if (!c) return;
    this.text.textContent = c.kind === "adjust"
      ? "Adjust: choose a new target or unit. Esc to cancel."
      : "Order: choose a target for the selected units. Esc to cancel.";
  }
}
