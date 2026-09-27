// Forge (River building) panel: a production queue. Forge a new agent type from a job, watch it train, train units.
import { api, type Store, type Bus, type UnitType } from "../core";
import { icon } from "../theme/icons";
import { h } from "./el";

const STAGES: { key: UnitType["status"]; label: string }[] = [
  { key: "generating", label: "Data" }, { key: "training", label: "Train" }, { key: "evaluating", label: "Eval" }, { key: "ready", label: "Ready" },
];

/** GET /api/forge/types/:id/eval (contract, Forge section). */
export interface ForgeEval {
  typeId: string; name: string; status: string; baseModel?: string; evalOrders?: number;
  metrics: { key: string; label: string; trained: number; base: number }[];
  training?: { examples?: number; steps?: number; epochs?: number; lossStart?: number; lossEnd?: number; trainSeconds?: number; evalSeconds?: number };
  sample?: { order: string; trained: string; base: string } | null;
}
const METRIC_NAMES: Record<string, string> = { style: "Style", grounded: "Grounded", overall: "Overall" };

/** Fallback before the eval endpoint answers: the scores the Forge writes into its stage text,
 *  "eval 0.82 vs base 0.42 (style 1.00 vs 0.46, grounded 0.64 vs 0.39)", as metrics with overall last. */
export function parseEval(stage: string): ForgeEval["metrics"] | null {
  const m = /eval ([\d.]+) vs base ([\d.]+)/.exec(stage);
  if (!m) return null;
  const parts = [...stage.matchAll(/\b([a-z]+) ([\d.]+) vs ([\d.]+)/g)]
    .filter((p) => p[1] !== "eval")
    .map((p) => ({ key: p[1]!, label: p[1]!, trained: Number(p[2]), base: Number(p[3]) }));
  return [...parts, { key: "overall", label: "Overall", trained: Number(m[1]), base: Number(m[2]) }];
}

/** Scores exactly as reported (up to 3 decimals), never rounded up for display. */
const score = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/(\.\d\d)0$/, "$1");
const secs = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}m ${String(Math.floor(v % 60)).padStart(2, "0")}s` : `${v.toFixed(1)}s`);

export class ForgePanel {
  readonly root: HTMLElement;
  /** Header stats (ready, in training); mounted by index.ts into the overlay header. */
  readonly stats: HTMLElement;
  private list: HTMLElement;
  private msg: HTMLElement;
  private statReady: HTMLElement;
  private statBusy: HTMLElement;
  private queueCount: HTMLElement;
  // Eval per ready type, fetched once: ForgeEval, "none" (404: dry run or not evaluated), or "loading".
  private evals = new Map<string, ForgeEval | "none" | "loading">();
  private sampleOpen = new Set<string>();
  private noneAt = new Map<string, number>();

  constructor(private store: Store, private bus: Bus) {
    const name = h("input", { class: "pnl-input", placeholder: "Name", maxLength: 40, required: true, title: "Type name, e.g. Refund Ranger" });
    const desc = h("textarea", { class: "pnl-input pnl-textarea", placeholder: "Job", rows: 4, required: true, title: "What this agent handles and how it should reply" });
    this.msg = h("span", { class: "pnl-msg" });
    const submit = h("button", { class: "pnl-btn pnl-btn-river", type: "submit", title: "Forge a new agent type" }, icon("forge"), "Forge");
    const form = h("form", {
      class: "pnl-forge-form",
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const n = name.value.trim();
        if (!n || !desc.value.trim()) return;
        submit.disabled = true;
        this.msg.className = "pnl-msg";
        this.msg.textContent = "Sending";
        const r = await api.forgeType(n, desc.value.trim());
        submit.disabled = false;
        if (r.ok) {
          this.msg.textContent = `Forging ${n}`;
          this.bus.toast(`Forging ${n}`);
          name.value = ""; desc.value = "";
        } else {
          this.msg.className = "pnl-msg pnl-err";
          this.msg.textContent = r.error;
          this.bus.toast(r.error, "error");
        }
      },
    },
      h("h3", { class: "pnl-h", title: "The Forge writes synthetic examples for the job, fine-tunes a small model with River and scores it against the base model. Ready types can be trained here." }, "New type"),
      name, desc, h("div", { class: "pnl-row" }, submit, this.msg));
    this.list = h("div", { class: "pnl-types" });
    this.statReady = h("b", {}, "0");
    this.statBusy = h("b", {}, "0");
    this.queueCount = h("span", { class: "pnl-count" });
    this.stats = h("div", { class: "pnl-stats" },
      h("span", { title: "Types ready to train" }, icon("check"), this.statReady, h("small", {}, "ready")),
      h("span", { title: "Types in the Forge" }, icon("clock"), this.statBusy, h("small", {}, "forging")));
    this.root = h("div", { class: "pnl-body pnl-forge" },
      h("div", { class: "pnl-col pnl-col-form" }, form),
      h("div", { class: "pnl-col pnl-col-queue" }, h("h3", { class: "pnl-h" }, "Queue", this.queueCount), this.list));
  }

  show(): void { this.render(); }

  render(): void {
    const all = this.store.getState().unitTypes.filter((t) => t.source === "forge");
    // Repeated names get a version mark in forge order: Refund Ranger v1, Refund Ranger v2.
    const seen = new Map<string, number>(), total = new Map<string, number>();
    for (const t of all) total.set(t.name, (total.get(t.name) ?? 0) + 1);
    const version = new Map<string, number>();
    for (const t of all) { const n = (seen.get(t.name) ?? 0) + 1; seen.set(t.name, n); if ((total.get(t.name) ?? 0) > 1) version.set(t.id, n); }

    const rank = (t: UnitType) => (t.status === "ready" ? 1 : t.status === "failed" ? 2 : 0);
    const types = all.filter((t) => t.status !== "failed").sort((a, b) => rank(a) - rank(b));
    const failed = all.filter((t) => t.status === "failed");
    const busy = all.filter((t) => t.status !== "ready" && t.status !== "failed").length;
    this.statReady.textContent = String(all.filter((t) => t.status === "ready").length);
    this.statBusy.textContent = String(busy);
    this.queueCount.textContent = all.length ? String(all.length) : "";
    this.list.replaceChildren();
    if (!all.length) { this.list.append(h("p", { class: "pnl-empty" }, "Queue empty")); return; }
    for (const t of types) this.list.append(this.card(t, version.get(t.id)));
    if (failed.length) {
      const box = h("details", { class: "pnl-failed" }, h("summary", {}, icon("chevron"), "Failed", h("span", { class: "pnl-count" }, String(failed.length))));
      for (const t of failed) box.append(this.card(t, version.get(t.id)));
      this.list.append(box);
    }
  }

  private card(t: UnitType, version?: number): HTMLElement {
    const extra = t as UnitType & { evalScore?: number | null; baseScore?: number | null; examples?: number };
    const stage = t.stage || "";
    const dry = /^dry[- ]run/.test(t.model ?? "") || /^dry run/.test(stage);
    const ready = t.status === "ready";
    const pct = Math.round((ready ? 1 : t.progress) * 100);
    const stageIdx = STAGES.findIndex((s) => s.key === t.status);
    if (ready && !dry) this.loadEval(t.id);
    const got = this.evals.get(t.id);
    const full = got && typeof got === "object" ? got : null;
    const metrics = full?.metrics?.length ? full.metrics : parseEval(stage);
    const train = h("button", {
      class: "pnl-btn", disabled: !ready, title: ready ? `Train a ${t.name}` : "Not ready",
      onclick: async () => {
        const r = await api.spawn({ class: t.id });
        this.bus.toast(r.ok ? `${t.name} trained` : r.error, r.ok ? "info" : "error");
      },
    }, icon("train"), "Train");
    // Detail for the curious lives in the tooltip: model URI and the Forge's own stage text.
    const tip = [t.model, stage].filter(Boolean).join("\n");
    const detail = !ready && t.status !== "failed" ? stage.replace(/^dry run:\s*/, "").replace(/^[a-z]+:\s*/, "") : "";

    return h("div", { class: `pnl-type pnl-type-${t.status}`, title: tip },
      h("div", { class: "pnl-type-head" },
        h("span", { class: "pnl-type-crest" }, icon("forged")),
        h("span", { class: "pnl-type-name" }, t.name, version ? h("small", {}, ` v${version}`) : null),
        dry ? h("span", { class: "pnl-tag", title: "Dry run: no real training" }, "Dry") : null,
        h("span", { style: "flex:1" }),
        train),
      h("div", { class: "pnl-track" }, ...STAGES.map((s, i) =>
        h("span", { class: ready || i < stageIdx ? "done" : i === stageIdx ? "now" : "" }, h("i"), s.label))),
      ready || t.status === "failed" ? null : h("div", { class: "pnl-bar" }, h("i", { style: `width:${pct}%` })),
      detail ? h("div", { class: "pnl-detail" }, detail, h("b", {}, `${pct}%`)) : null,
      metrics ? this.evalBlock(t.id, metrics, full) : ready && dry ? h("div", { class: "pnl-detail" }, "No eval score") : null,
      t.status === "failed" ? h("div", { class: "pnl-detail pnl-err" }, "Training failed") : null);
  }

  private async loadEval(id: string): Promise<void> {
    const had = this.evals.get(id);
    if (had === "none" && Date.now() - (this.noneAt.get(id) ?? 0) > 20000) this.evals.delete(id); // endpoint may have landed since
    else if (had) return;
    this.evals.set(id, "loading");
    const r = await api.get<ForgeEval>(`/api/forge/types/${encodeURIComponent(id)}/eval`);
    if (r.ok && Array.isArray((r as unknown as ForgeEval).metrics)) this.evals.set(id, r as unknown as ForgeEval);
    else if (!r.ok && /404|not found/i.test(r.error)) { this.evals.set(id, "none"); this.noneAt.set(id, Date.now()); return; }
    else { this.evals.delete(id); return; } // transient: try again on a later render
    if (this.root.isConnected) this.render();
  }

  /** Trained vs base per metric (overall last and emphasised), the training line, and the held-out sample toggle. */
  private evalBlock(id: string, metrics: ForgeEval["metrics"], full: ForgeEval | null): HTMLElement {
    const ordered = [...metrics.filter((m) => m.key !== "overall"), ...metrics.filter((m) => m.key === "overall")];
    const rows = ordered.map((m) => {
      const d = m.trained - m.base;
      const pct = (v: number) => `width:${Math.max(0, Math.min(1, v)) * 100}%`;
      return h("div", { class: `pnl-metric${m.key === "overall" ? " pnl-metric-overall" : ""}`, title: `${m.label}: trained ${score(m.trained)}, base ${score(m.base)}` },
        h("span", { class: "pnl-metric-k" }, METRIC_NAMES[m.key] ?? m.label),
        h("div", { class: "pnl-metric-bars" }, h("i", { class: "t", style: pct(m.trained) }), h("i", { class: "b", style: pct(m.base) })),
        h("b", { class: "pnl-metric-t" }, score(m.trained)),
        h("span", { class: "pnl-metric-b" }, score(m.base)),
        h("span", { class: `pnl-metric-d ${d >= 0 ? "up" : "down"}` }, `${d >= 0 ? "+" : ""}${score(d)}`));
    });
    const tr = full?.training;
    const stat = (k: string, v: string, tip?: string) => h("span", { title: tip ?? "" }, h("small", {}, k), h("b", {}, v));
    const stats = tr ? h("div", { class: "pnl-train" },
      tr.examples != null ? stat("Examples", String(tr.examples)) : null,
      tr.steps != null ? stat("Steps", String(tr.steps), tr.epochs != null ? `${tr.epochs} epochs` : undefined) : null,
      tr.trainSeconds != null ? stat("Train", secs(tr.trainSeconds), tr.evalSeconds != null ? `Eval took ${secs(tr.evalSeconds)}` : undefined) : null,
      tr.lossEnd != null ? stat("Loss", score(tr.lossEnd), tr.lossStart != null ? `Loss from ${score(tr.lossStart)} to ${score(tr.lossEnd)}` : undefined) : null,
      full?.evalOrders != null ? stat("Held-out", String(full.evalOrders), "Held-out orders scored") : null) : null;
    const open = this.sampleOpen.has(id);
    const sample = full?.sample;
    const toggle = sample ? h("button", {
      class: `pnl-toggle${open ? " on" : ""}`, title: "Show one held-out order with both answers",
      onclick: () => { if (open) this.sampleOpen.delete(id); else this.sampleOpen.add(id); this.render(); },
    }, icon("chevron"), "Held-out sample") : null;
    return h("div", { class: "pnl-eval" },
      h("div", { class: "pnl-metric pnl-metric-head" }, h("span", {}), h("span", {}),
        h("span", { class: "pnl-metric-t" }, "Trained"), h("span", { class: "pnl-metric-b", title: full?.baseModel ? `Base model ${full.baseModel}` : "Base model" }, "Base"), h("span", {})),
      ...rows,
      stats || toggle ? h("div", { class: "pnl-eval-foot" }, stats, h("span", { style: "flex:1" }), toggle) : null,
      sample && open ? h("div", { class: "pnl-sample" },
        h("p", { class: "pnl-sample-order" }, sample.order),
        h("div", { class: "pnl-sample-cols" },
          h("div", { class: "pnl-sample-a t" }, h("small", {}, "Trained"), h("p", {}, sample.trained)),
          h("div", { class: "pnl-sample-a b" }, h("small", {}, "Base"), h("p", {}, sample.base)))) : null);
  }
}
