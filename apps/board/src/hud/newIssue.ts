// Spawn-issue dialog (raid-ui-plan): hotkey N or bus.newIssue() (top-bar button). Random draws an issue from the
// brain pool; the form sets title, zone, kind and severity. The engine emits target.spawned and the camp rises.
import { api, type Bus, type SpawnTarget, type Store, type Target } from "../core";
import { h } from "./dom";

const CSS = `
.nix { position: absolute; top: calc(var(--hud-top, 50px) + 16px); left: 50%; transform: translateX(-50%); width: 344px;
  padding: 16px; box-sizing: border-box; pointer-events: auto; z-index: 30; color: #e9e2d0;
  background: rgba(22, 26, 31, .92); border: 1px solid rgba(201, 164, 98, .55); border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .06);
  font: 13px/1.4 "Avenir Next", "Segoe UI", system-ui, sans-serif; transition: opacity 150ms ease, transform 150ms ease; }
.nix[hidden] { display: none; }
.nix-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 16px;
  font: 600 13px/1 "Avenir Next Condensed", "Arial Narrow", sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #d9b56f; }
.nix-x { background: none; border: 0; color: #9a927f; font-size: 16px; cursor: pointer; padding: 0 4px; }
.nix-x:hover { color: #e9e2d0; }
.nix-btn { display: flex; align-items: center; justify-content: space-between; width: 100%; height: 40px; padding: 0 16px;
  box-sizing: border-box; border: 1px solid rgba(201, 164, 98, .6); border-radius: 3px; cursor: pointer;
  background: linear-gradient(#3a3226, #29241c); color: #f3e7c9; font: 600 13px/1 "Avenir Next Condensed", "Arial Narrow", sans-serif;
  letter-spacing: .1em; text-transform: uppercase; transition: box-shadow 120ms ease, filter 120ms ease; }
.nix-btn:hover:not(:disabled) { box-shadow: 0 0 0 1px rgba(217, 181, 111, .6), 0 0 12px rgba(217, 181, 111, .25); filter: brightness(1.1); }
.nix-btn:disabled { opacity: .45; cursor: default; }
.nix-key { font: 11px/1 ui-monospace, Menlo, monospace; color: #9a927f; letter-spacing: 0; }
.nix-or { display: flex; align-items: center; gap: 8px; margin: 16px 0; color: #7d7667; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
.nix-or::before, .nix-or::after { content: ""; flex: 1; height: 1px; background: rgba(201, 164, 98, .25); }
.nix-form { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.nix-form label { display: grid; gap: 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9a927f; }
.nix-form .nix-wide { grid-column: 1 / -1; }
.nix-form input, .nix-form select { height: 32px; box-sizing: border-box; padding: 0 8px; border-radius: 3px; font: 13px system-ui, sans-serif;
  color: #e9e2d0; background: rgba(0, 0, 0, .35); border: 1px solid rgba(201, 164, 98, .3); }
.nix-form input:focus, .nix-form select:focus { outline: none; border-color: rgba(217, 181, 111, .8); }
.nix-form .nix-btn { grid-column: 1 / -1; margin-top: 8px; }
.nix-err { min-height: 16px; margin-top: 8px; color: #e0775f; font-size: 12px; }
`;

export class NewIssueDialog {
  readonly root: HTMLElement;
  private title = h("input", { type: "text", maxlength: 120, placeholder: "Leave empty for a random issue", "aria-label": "Title" });
  private zone = h("select", { "aria-label": "Zone" });
  private kind = h("select", { "aria-label": "Kind" }, h("option", { value: "bug" }, "Bug"), h("option", { value: "feature" }, "Feature"));
  private severity = h("select", { "aria-label": "Severity" },
    h("option", { value: "1" }, "Low"), h("option", { value: "2", selected: true }, "Medium"), h("option", { value: "3" }, "High"));
  private err = h("div", { class: "nix-err", role: "status" });
  private randomBtn: HTMLButtonElement;
  private spawnBtn: HTMLButtonElement;
  private busy = false;
  private session = 0; // bumps on every open and close, so a late reply only acts on the view it came from

  constructor(private store: Store, private bus: Bus) {
    this.randomBtn = h("button", { class: "nix-btn", type: "button", title: "Spawn a random issue from the Library pool", onclick: () => void this.random() },
      "Random", h("span", { class: "nix-key" }, "Enter"));
    this.spawnBtn = h("button", { class: "nix-btn", type: "submit" }, "Spawn", h("span", { class: "nix-key" }, "Enter"));
    const form = h("form", { class: "nix-form", onsubmit: (e: Event) => { e.preventDefault(); void this.submit(); } },
      h("label", { class: "nix-wide" }, "Title", this.title),
      h("label", {}, "Zone", this.zone), h("label", {}, "Kind", this.kind), h("label", {}, "Severity", this.severity),
      this.spawnBtn);
    this.root = h("section", { class: "nix", hidden: true, role: "dialog", "aria-label": "New issue" },
      h("header", { class: "nix-head" }, "New issue", h("button", { class: "nix-x", type: "button", title: "Close (Esc)", onclick: () => this.close() }, "×")),
      this.randomBtn, h("div", { class: "nix-or" }, "or"), form, this.err);
  }

  get isOpen(): boolean { return !this.root.hidden; }

  open(): void {
    const zones = this.store.getState().components;
    const keep = this.zone.value;
    this.zone.replaceChildren(h("option", { value: "" }, "Least busy"), ...zones.map((c) => h("option", { value: c.id }, c.name)));
    this.zone.value = zones.some((c) => c.id === keep) ? keep : "";
    this.err.textContent = "";
    this.session++;
    this.root.hidden = false;
    this.randomBtn.focus();
  }

  close(): void {
    this.session++;
    this.root.hidden = true;
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  toggle(): void { if (this.isOpen) this.close(); else this.open(); }

  /** One click: the engine draws the next issue from the brain pool. */
  random(): Promise<Target | null> { return this.spawn({}); }

  submit(): Promise<Target | null> {
    const title = this.title.value.trim();
    if (!title) return this.random();
    const body: SpawnTarget = { title, kind: this.kind.value as Target["kind"], severity: Number(this.severity.value) as Target["severity"] };
    if (this.zone.value) body.component = this.zone.value;
    return this.spawn(body);
  }

  private async spawn(body: SpawnTarget): Promise<Target | null> {
    if (this.busy) return null;
    this.setBusy(true);
    const session = this.session, sent = this.title.value;
    const r = await api.spawnTarget(body);
    this.setBusy(false);
    // Only the view that sent the request, with the draft untouched since, is cleared and closed.
    const same = session === this.session && this.title.value === sent;
    if (!r.ok) { if (session === this.session) this.err.textContent = r.error; return null; }
    const t = r.target ?? null;
    if (same) { this.title.value = ""; this.close(); }
    if (t) {
      const zone = this.store.getState().components.find((c) => c.id === t.component)?.name ?? t.component;
      this.bus.toast(`${t.issue} spawned in ${zone}`);
      this.bus.focusTile(t.pos.x, t.pos.y);
    }
    return t;
  }

  private setBusy(on: boolean): void {
    this.busy = on;
    this.randomBtn.disabled = on;
    this.spawnBtn.disabled = on;
  }
}

/** Mounts the dialog into the HUD layer: hotkey N toggles it, bus.newIssue() opens it, Esc closes it. */
export function mountNewIssue(el: HTMLElement, store: Store, bus: Bus): () => void {
  if (!document.getElementById("nix-css")) document.head.append(h("style", { id: "nix-css" }, CSS));
  const dlg = new NewIssueDialog(store, bus);
  el.append(dlg.root);
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && dlg.isOpen) { e.stopPropagation(); e.preventDefault(); dlg.close(); return; }
    if (dlg.isOpen && dlg.root.contains(e.target as Node)) { e.stopPropagation(); return; } // typing here never pans or fires hotkeys
    if ((e.key === "n" || e.key === "N") && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !typing(e.target)) {
      e.preventDefault(); e.stopPropagation(); dlg.toggle();
    }
  };
  window.addEventListener("keydown", onKey, true);
  const off = bus.on("newIssue", () => dlg.open());
  return () => { window.removeEventListener("keydown", onKey, true); off(); dlg.root.remove(); };
}
