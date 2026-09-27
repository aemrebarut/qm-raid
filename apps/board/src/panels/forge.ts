// Forge (River building) panel: forge a new agent type from a job description, watch it train, then train units.
import { api, type Store, type Bus, type UnitType } from "../core";
import { h } from "./el";

const STAGES: UnitType["status"][] = ["generating", "training", "evaluating", "ready"];

export class ForgePanel {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private msg: HTMLElement;

  constructor(private store: Store, private bus: Bus) {
    const name = h("input", { class: "pnl-input", placeholder: "Type name, e.g. Refund Ranger", maxLength: 40, required: true });
    const desc = h("textarea", { class: "pnl-input pnl-textarea", placeholder: "Describe the job: what this agent handles and how it should reply", rows: 3, required: true });
    this.msg = h("span", { class: "pnl-sub" });
    const submit = h("button", { class: "pnl-btn pnl-btn-primary", type: "submit" }, "Forge new type");
    const form = h("form", {
      class: "pnl-forge-form",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!name.value.trim() || !desc.value.trim()) return;
        submit.disabled = true;
        this.msg.textContent = "Sending to the Forge...";
        const r = await api.forgeType(name.value.trim(), desc.value.trim());
        submit.disabled = false;
        if (r.ok) {
          this.msg.textContent = `Forging ${name.value.trim()}: generating synthetic data, then River fine-tunes it.`;
          this.bus.toast(`Forge started: ${name.value.trim()}`);
          name.value = ""; desc.value = "";
        } else {
          this.msg.textContent = `Forge error: ${r.error}`;
          this.bus.toast(r.error, "error");
        }
      },
    }, h("h3", {}, "New agent type"), name, desc, h("div", { class: "pnl-row" }, submit, this.msg));
    this.list = h("div", { class: "pnl-types" });
    this.root = h("div", { class: "pnl-body pnl-forge" },
      h("div", { class: "pnl-col" }, form, h("p", { class: "pnl-hint" }, "The Forge writes synthetic training examples for the job, fine-tunes a small model with River, evaluates it, and then units of the new type can be trained here.")),
      h("div", { class: "pnl-col pnl-col-side" }, h("h3", {}, "Forged types"), this.list));
  }

  show(): void { this.render(); }

  render(): void {
    const all = this.store.getState().unitTypes.filter((t) => t.source === "forge");
    const rank = (t: UnitType) => (t.status === "ready" ? 0 : t.status === "failed" ? 2 : 1);
    const types = all.filter((t) => t.status !== "failed").sort((a, b) => rank(a) - rank(b));
    const failed = all.filter((t) => t.status === "failed");
    this.list.replaceChildren();
    if (!all.length) { this.list.append(h("p", { class: "pnl-hint" }, "None yet. Forge one on the left.")); return; }
    for (const t of types) this.list.append(this.card(t));
    if (failed.length) {
      const box = h("details", { class: "pnl-failed" }, h("summary", { class: "pnl-sub" }, `Failed (${failed.length})`));
      for (const t of failed) box.append(this.card(t));
      this.list.append(box);
    }
  }

  private card(t: UnitType): HTMLElement {
    const extra = t as UnitType & { evalScore?: number | null; examples?: number; description?: string };
    const pct = Math.round((t.status === "ready" ? 1 : t.progress) * 100);
    const stageIdx = STAGES.indexOf(t.status);
    const train = h("button", {
      class: "pnl-btn", disabled: t.status !== "ready",
      onclick: async () => {
        const r = await api.spawn({ class: t.id });
        this.bus.toast(r.ok ? `A ${t.name} walks out of the Forge` : r.error, r.ok ? "info" : "error");
      },
    }, "Train unit");
    return h("div", { class: `pnl-type pnl-type-${t.status}` },
      h("div", { class: "pnl-row" }, h("b", {}, t.name), h("span", { class: "pnl-sub" }, ` ${t.status}`), h("span", { style: "flex:1" }), train),
      h("div", { class: "pnl-steps" }, ...STAGES.map((s, i) => h("span", { class: i < stageIdx || t.status === "ready" ? "done" : i === stageIdx ? "now" : "" }, s))),
      h("div", { class: "pnl-bar" }, h("i", { style: `width:${pct}%` })),
      h("div", { class: "pnl-sub" },
        t.stage || "",
        extra.examples != null ? ` · ${extra.examples} examples` : "",
        extra.evalScore != null ? ` · eval ${(extra.evalScore * 100).toFixed(0)}%` : "",
        t.model ? ` · ${t.model}` : ""),
      t.status === "failed" ? h("div", { class: "pnl-err" }, "Training failed.") : null);
  }
}
