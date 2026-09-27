// Loadout view (raid-ui-plan): a unit's standing orders (system prompt), skills, plugins, model and effort.
// Hook for the side panel tab: `const lo = new LoadoutView(store, bus); tab.append(lo.root); lo.show(unitId)` whenever the
// tab opens or the selected unit changes; `lo.show(null)` empties it; `lo.dispose()` on unmount.
// Apply sends only the changed fields: PATCH /api/units/:id {instructions?, skills?, plugins?, model?, effort?}.
import { api, type Bus, type CatalogItem, type Store, type Unit } from "../core";
import { h } from "./dom";

const MODELS = ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const EFFORTS = ["auto", "low", "medium", "high", "xhigh"];
/** Standing orders that toggle a line in the instructions. */
export const ORDERS: { label: string; line: string }[] = [
  { label: "Recall first", line: "Recall from the Library before you act and cite the pages you used." },
  { label: "Tests first", line: "Write the failing regression test before any fix." },
  { label: "House rules", line: "Check every change against the house rules and name the rule you applied." },
  { label: "Customer voice", line: "When a customer is affected, draft their update in the house tone." },
  { label: "Brief", line: "Keep replies under 120 words: what you found, what you changed, what is left." },
];
const CATALOG_TTL_MS = 30_000;

interface Draft { instructions: string; skills: string[]; plugins: string[]; model: string; effort: string }

const CSS = `
.ldo { display: grid; gap: 16px; color: #e9e2d0; font: 12px/1.4 "Avenir Next", "Segoe UI", system-ui, sans-serif; }
.ldo-empty { color: #9a927f; }
.ldo-sec { display: grid; gap: 8px; }
.ldo-h { margin: 0; font: 600 11px/1 "Avenir Next Condensed", "Arial Narrow", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #d9b56f; }
.ldo textarea { width: 100%; min-height: 96px; box-sizing: border-box; padding: 8px; resize: vertical; border-radius: 3px;
  font: 12px/1.45 ui-monospace, Menlo, monospace; color: #e9e2d0; background: rgba(0, 0, 0, .35); border: 1px solid rgba(201, 164, 98, .3); }
.ldo textarea:focus, .ldo select:focus { outline: none; border-color: rgba(217, 181, 111, .8); }
.ldo-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.ldo-chip { height: 24px; padding: 0 8px; border-radius: 12px; cursor: pointer; font: 11px system-ui, sans-serif; color: #cfc6b0;
  background: rgba(255, 255, 255, .04); border: 1px solid rgba(201, 164, 98, .3); transition: background 120ms ease, border-color 120ms ease; }
.ldo-chip[aria-pressed="true"] { color: #1d1a14; background: #d9b56f; border-color: #d9b56f; }
.ldo-list { display: grid; gap: 2px; }
.ldo-item { display: grid; grid-template-columns: 16px 1fr; gap: 0 8px; align-items: start; padding: 4px; border-radius: 3px; cursor: pointer; }
.ldo-item:hover { background: rgba(255, 255, 255, .04); }
.ldo-item input { margin: 2px 0 0; accent-color: #d9b56f; }
.ldo-name { color: #f3e7c9; }
.ldo-desc { grid-column: 2; color: #9a927f; font-size: 11px; }
.ldo-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.ldo select { height: 28px; padding: 0 4px; border-radius: 3px; font: 12px system-ui, sans-serif; color: #e9e2d0;
  background: rgba(0, 0, 0, .35); border: 1px solid rgba(201, 164, 98, .3); }
.ldo-foot { display: flex; align-items: center; gap: 8px; }
.ldo-btn { height: 32px; padding: 0 16px; border-radius: 3px; cursor: pointer; border: 1px solid rgba(201, 164, 98, .6);
  background: linear-gradient(#3a3226, #29241c); color: #f3e7c9; font: 600 12px/1 "Avenir Next Condensed", "Arial Narrow", sans-serif;
  letter-spacing: .1em; text-transform: uppercase; transition: box-shadow 120ms ease, filter 120ms ease; }
.ldo-btn:hover:not(:disabled) { box-shadow: 0 0 0 1px rgba(217, 181, 111, .6), 0 0 12px rgba(217, 181, 111, .25); filter: brightness(1.1); }
.ldo-btn:disabled { opacity: .45; cursor: default; }
.ldo-btn-ghost { background: none; border-color: rgba(201, 164, 98, .3); color: #cfc6b0; }
.ldo-status { font-size: 11px; color: #9a927f; }
.ldo-status[data-state="applying"] { color: #d9b56f; }
.ldo-status[data-state="applied"] { color: #7fbf7a; }
.ldo-status[data-state="error"] { color: #e0775f; }
`;

function draftOf(u: Unit): Draft {
  return {
    instructions: u.loadout?.instructions ?? "",
    skills: [...(u.loadout?.skills ?? [])],
    plugins: [...(u.loadout?.plugins ?? [])],
    model: u.model,
    effort: u.effort,
  };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The fields of `d` that differ from `base`, as a PATCH body. */
export function loadoutPatch(base: Draft, d: Draft): Partial<Draft> {
  const out: Partial<Draft> = {};
  if (d.instructions !== base.instructions) out.instructions = d.instructions;
  if (!sameSet(d.skills, base.skills)) out.skills = [...d.skills];
  if (!sameSet(d.plugins, base.plugins)) out.plugins = [...d.plugins];
  if (d.model !== base.model) out.model = d.model;
  if (d.effort !== base.effort) out.effort = d.effort;
  return out;
}

export class LoadoutView {
  readonly root = h("section", { class: "ldo", "aria-label": "Loadout" });
  private unitId: string | null = null;
  private base: Draft | null = null;
  private draft: Draft | null = null;
  private applyGen = 0;
  private state: "" | "applying" | "applied" | "error" = "";
  private errText = "";
  private catalog: CatalogItem[] | null = null;
  private catalogAt = 0;
  private catalogErr = "";
  private catalogGen = 0;
  private offStore: () => void;
  // Bound per unit in build()
  private text!: HTMLTextAreaElement;
  private chips!: HTMLElement;
  private skills!: HTMLElement;
  private plugins!: HTMLElement;
  private model!: HTMLSelectElement;
  private effort!: HTMLSelectElement;
  private applyBtn!: HTMLButtonElement;
  private revertBtn!: HTMLButtonElement;
  private status!: HTMLElement;

  constructor(private store: Store, _bus: Bus) {
    if (!document.getElementById("ldo-css")) document.head.append(h("style", { id: "ldo-css" }, CSS));
    // Keys typed or pressed in here never reach the grid hotkeys or the camera.
    this.root.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
    this.offStore = store.subscribe(() => this.sync());
    this.show(null);
  }

  get dirty(): boolean { return !!this.base && !!this.draft && Object.keys(loadoutPatch(this.base, this.draft)).length > 0; }

  show(unitId: string | null): void {
    const u = this.store.unit(unitId);
    if (u && u.id === this.unitId) return;
    this.unitId = u?.id ?? null;
    this.applyGen++; // a reply for the previous unit must not touch this view
    this.state = "";
    if (!u) {
      this.base = this.draft = null;
      this.root.replaceChildren(h("p", { class: "ldo-empty" }, "No unit selected"));
      return;
    }
    this.base = draftOf(u);
    this.draft = draftOf(u);
    this.build(u);
    void this.loadCatalog();
  }

  dispose(): void { this.offStore(); this.root.remove(); }

  /** Sends the changed fields. Resolves true when the engine accepted them. */
  async apply(): Promise<boolean> {
    if (!this.unitId || !this.base || !this.draft) return false;
    const body = loadoutPatch(this.base, this.draft);
    if (!Object.keys(body).length) return false;
    const id = this.unitId, gen = ++this.applyGen;
    const sent = structuredClone(this.draft);
    this.setState("applying");
    const r = await api.patchUnit(id, body);
    if (gen !== this.applyGen || id !== this.unitId) return r.ok; // superseded: another unit or a newer Apply
    if (!r.ok) { this.setState("error", r.error); return false; }
    this.base = r.unit ? draftOf(r.unit) : { ...this.base, ...sent };
    const untouched = !Object.keys(loadoutPatch(sent, this.draft)).length;
    if (untouched) { // show what the agent really carries now (the bridge may normalise, e.g. Forge plugins)
      this.draft = structuredClone(this.base);
      const u = this.store.unit(id);
      if (u) this.build(u);
    }
    this.setState(untouched ? "applied" : ""); // edits made while applying stay pending
    return true;
  }

  revert(): void {
    if (!this.base || !this.unitId) return;
    this.draft = structuredClone(this.base);
    const u = this.store.unit(this.unitId);
    if (u) this.build(u);
  }

  // A unit.updated from the engine: refresh a clean view; keep a dirty draft but diff it against the new base.
  private sync(): void {
    if (!this.unitId) return;
    const u = this.store.unit(this.unitId);
    if (!u) { this.unitId = null; this.show(null); return; }
    const next = draftOf(u);
    if (this.base && !Object.keys(loadoutPatch(this.base, next)).length) return;
    const wasDirty = this.dirty;
    if (!wasDirty && this.state !== "applying") { this.base = next; this.draft = structuredClone(next); this.build(u); return; }
    // Three-way: fields the user has not touched follow the engine; edited fields keep the draft.
    const edited = loadoutPatch(this.base!, this.draft!);
    this.draft = { ...structuredClone(next), ...structuredClone(edited) };
    this.base = next;
    this.syncControls();
    this.refreshFoot();
  }

  private async loadCatalog(force = false): Promise<void> {
    if (!force && this.catalog && Date.now() - this.catalogAt < CATALOG_TTL_MS) return;
    const gen = ++this.catalogGen;
    const r = await api.catalog();
    if (gen !== this.catalogGen) return;
    if (r.ok) { this.catalog = Array.isArray(r.items) ? r.items : []; this.catalogAt = Date.now(); this.catalogErr = ""; }
    else this.catalogErr = r.error;
    if (this.unitId) this.renderLists();
  }

  private build(u: Unit): void {
    const d = this.draft!;
    this.text = h("textarea", { rows: 6, spellcheck: "false", "aria-label": "Standing orders" }) as HTMLTextAreaElement;
    this.text.value = d.instructions;
    this.text.addEventListener("input", () => { this.draft!.instructions = this.text.value; this.renderChips(); this.edited(); });
    this.chips = h("div", { class: "ldo-chips" });
    this.skills = h("div", { class: "ldo-list" });
    this.plugins = h("div", { class: "ldo-list" });
    const models = MODELS.includes(d.model) ? MODELS : [d.model, ...MODELS];
    this.model = h("select", { "aria-label": "Model" }, ...models.map((m) => h("option", { value: m }, m))) as HTMLSelectElement;
    this.model.value = d.model;
    this.model.addEventListener("change", () => { this.draft!.model = this.model.value; this.edited(); });
    const efforts = EFFORTS.includes(d.effort) ? EFFORTS : [d.effort, ...EFFORTS];
    this.effort = h("select", { "aria-label": "Effort" }, ...efforts.map((m) => h("option", { value: m }, m))) as HTMLSelectElement;
    this.effort.value = d.effort;
    this.effort.addEventListener("change", () => { this.draft!.effort = this.effort.value; this.edited(); });
    this.applyBtn = h("button", { class: "ldo-btn", type: "button", title: "Send the changes to this agent", onclick: () => void this.apply() }, "Apply") as HTMLButtonElement;
    this.revertBtn = h("button", { class: "ldo-btn ldo-btn-ghost", type: "button", title: "Discard the changes", onclick: () => this.revert() }, "Revert") as HTMLButtonElement;
    this.status = h("span", { class: "ldo-status", role: "status" });
    this.root.replaceChildren(
      h("div", { class: "ldo-sec" }, h("h4", { class: "ldo-h" }, "Orders"), this.chips, this.text),
      h("div", { class: "ldo-sec" }, h("h4", { class: "ldo-h" }, "Skills"), this.skills),
      h("div", { class: "ldo-sec" }, h("h4", { class: "ldo-h" }, "Plugins"), this.plugins),
      h("div", { class: "ldo-sec" }, h("h4", { class: "ldo-h" }, "Model"), h("div", { class: "ldo-row" }, this.model, this.effort)),
      h("div", { class: "ldo-foot" }, this.applyBtn, this.revertBtn, this.status),
    );
    this.root.dataset.unit = u.id;
    this.renderChips();
    this.renderLists();
    this.refreshFoot();
  }

  // Puts draft values into the existing controls without rebuilding (keeps focus and caret in the textarea).
  private syncControls(): void {
    const d = this.draft!;
    if (this.text.value !== d.instructions) this.text.value = d.instructions;
    if (![...this.model.options].some((o) => o.value === d.model)) this.model.append(h("option", { value: d.model }, d.model));
    if (![...this.effort.options].some((o) => o.value === d.effort)) this.effort.append(h("option", { value: d.effort }, d.effort));
    this.model.value = d.model;
    this.effort.value = d.effort;
    this.renderChips();
    this.renderLists();
  }

  private renderChips(): void {
    const text = this.draft!.instructions;
    this.chips.replaceChildren(...ORDERS.map((o) => h("button", {
      class: "ldo-chip", type: "button", title: o.line, "aria-pressed": String(text.includes(o.line)),
      onclick: () => this.toggleOrder(o.line),
    }, o.label)));
  }

  private toggleOrder(line: string): void {
    const d = this.draft!;
    const lines = d.instructions.split("\n");
    d.instructions = lines.includes(line) ? lines.filter((l) => l !== line).join("\n") : [d.instructions.trimEnd(), line].filter(Boolean).join("\n");
    this.text.value = d.instructions;
    this.renderChips();
    this.edited();
  }

  private renderLists(): void {
    if (!this.draft) return;
    const items = this.catalog ?? [];
    const list = (kind: CatalogItem["kind"], picked: string[], el: HTMLElement) => {
      const known = items.filter((i) => i.kind === kind);
      const extra = picked.filter((id) => !known.some((i) => i.id === id)).map((id) => ({ id, name: id, description: "Not in the catalog", kind }));
      const all = [...known, ...extra];
      if (!all.length) { el.replaceChildren(h("p", { class: "ldo-empty" }, this.catalogErr ? `Catalog unavailable: ${this.catalogErr}` : this.catalog ? "None available" : "Loading")); return; }
      el.replaceChildren(...all.map((i) => {
        const box = h("input", { type: "checkbox", checked: picked.includes(i.id) }) as HTMLInputElement;
        box.addEventListener("change", () => {
          const at = picked.indexOf(i.id);
          if (box.checked && at < 0) picked.push(i.id);
          if (!box.checked && at >= 0) picked.splice(at, 1);
          this.edited();
        });
        return h("label", { class: "ldo-item", title: i.id }, box, h("span", { class: "ldo-name" }, i.name), h("span", { class: "ldo-desc" }, i.description));
      }));
    };
    list("skill", this.draft.skills, this.skills);
    list("plugin", this.draft.plugins, this.plugins);
  }

  private edited(): void {
    if (this.state === "applied" || this.state === "error") this.state = "";
    this.refreshFoot();
  }

  private setState(s: LoadoutView["state"], detail = ""): void {
    this.state = s;
    this.errText = detail;
    this.refreshFoot();
  }

  private refreshFoot(): void {
    if (!this.applyBtn) return;
    const applying = this.state === "applying";
    this.applyBtn.disabled = applying || !this.dirty;
    this.applyBtn.textContent = applying ? "Applying" : "Apply";
    this.revertBtn.disabled = applying || !this.dirty;
    this.status.dataset.state = this.state;
    this.status.textContent = this.state === "applying" ? "Sending to the agent"
      : this.state === "applied" ? "Applied"
      : this.state === "error" ? this.errText || "Not applied"
      : this.dirty ? "Unsaved changes" : "";
  }
}
