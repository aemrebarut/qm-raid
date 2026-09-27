// Library (GBrain) panel: the knowledge graph as the hero, search, page view with wikilinks, and the memory feed.
import { api, type Store, type Bus, type EngineEvent } from "../core";
import { icon } from "../theme/icons";
import { h, renderMarkdown, ago } from "./el";
import { GraphView, TYPE_COLORS, TYPE_LABELS } from "./graph";

/** Human title for a brain slug when the graph has none: learnings/lum-101-u3-1790... -> "LUM-101 learning". */
export function slugTitle(slug: string): string {
  const leaf = slug.split("/").pop() ?? slug;
  const learn = /^(?:([a-z]+-\d+)|general)-u\d+-\d+$/.exec(leaf);
  if (learn) return learn[1] ? `${learn[1].toUpperCase()} learning` : "Learning";
  if (/^[a-z]+-\d+$/.test(leaf)) return leaf.toUpperCase();
  const words = leaf.replace(/[-_]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : slug;
}

export class LibraryPanel {
  readonly root: HTMLElement;
  /** Header stats (pages, links); mounted by index.ts into the overlay header. */
  readonly stats: HTMLElement;
  private graph: GraphView;
  private pageBox: HTMLElement;
  private results: HTMLElement;
  private feed: HTMLElement;
  private legendEl: HTMLElement;
  private loading: HTMLElement;
  private statPages: HTMLElement;
  private statLinks: HTMLElement;
  private loadedAt = 0;
  private inflight = false;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  // Request generations: a response is applied only if no newer request of the same kind started since.
  private pageGen = 0;
  private searchGen = 0;
  private graphGen = 0;

  constructor(private store: Store, private bus: Bus) {
    this.graph = new GraphView((slug) => this.openPage(slug));
    this.graph.label = (n) => this.nodeLabel(n.id, n.title);
    this.pageBox = h("div", { class: "pnl-page", hidden: true });
    this.results = h("div", { class: "pnl-results" });
    this.feed = h("div", { class: "pnl-feed" });
    this.legendEl = h("div", { class: "pnl-legend" });
    this.loading = h("div", { class: "pnl-loading" }, h("i"), h("span", {}, "Loading pages"));
    this.statPages = h("b", {}, "0");
    this.statLinks = h("b", {}, "0");
    this.stats = h("div", { class: "pnl-stats" },
      h("span", { title: "Pages in the Library" }, icon("pages"), this.statPages, h("small", {}, "pages")),
      h("span", { title: "Links between pages" }, icon("link"), this.statLinks, h("small", {}, "links")));
    this.stats.hidden = true; // until the graph lands
    const input = h("input", { class: "pnl-input", placeholder: "Search", type: "search", title: "Search the Library (Enter)" });
    const form = h("form", { class: "pnl-search", onsubmit: (e: Event) => { e.preventDefault(); this.search(input.value); } },
      icon("search"), input);
    input.addEventListener("input", () => { if (!input.value.trim()) this.results.replaceChildren(); });

    this.root = h("div", { class: "pnl-body pnl-library" },
      h("div", { class: "pnl-col pnl-col-graph" },
        h("div", { class: "pnl-graph-wrap" }, this.graph.canvas, this.graph.tip, this.loading),
        this.legendEl),
      h("div", { class: "pnl-col pnl-col-side" },
        form, this.results, this.pageBox,
        h("h3", { class: "pnl-h" }, "Recent"), this.feed),
    );
  }

  /** Fetch the graph ahead of the first open (the brain can take seconds cold). */
  prefetch(): void { if (!this.loadedAt) this.loadGraph(); }

  show(): void {
    if (!this.inflight && Date.now() - this.loadedAt > 5000) this.loadGraph();
    this.renderFeed();
    this.graph.start();
    if (!this.clock) this.clock = setInterval(() => { if (this.root.isConnected) this.renderFeed(); else this.hide(); }, 5000);
  }

  hide(): void { if (this.clock) { clearInterval(this.clock); this.clock = null; } }

  /** The whole state was replaced (fixture to live, reconnect, reset): refresh everything shown. */
  onReset(): void {
    this.loadGraph(); // also while closed, so the next open is warm
    if (this.root.isConnected) this.renderFeed();
  }

  onEvent(ev: EngineEvent): void {
    if (ev.type === "memory.recall") this.graph.flash(ev.slugs, "#6fa8ff");
    else if (ev.type === "memory.remember") {
      this.graph.flash([ev.slug], "#e0b454");
      this.scheduleRefresh(); // new learning pages join the graph
    } else if (ev.type === "memory.link") this.graph.flash([ev.from, ev.to], "#e0b454");
    else return;
    if (this.root.isConnected) this.renderFeed();
  }

  private scheduleRefresh(ms = 1500): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; if (this.root.isConnected) this.loadGraph(); }, ms);
  }

  private async loadGraph(): Promise<void> {
    this.loadedAt = Date.now();
    const gen = ++this.graphGen;
    const first = !this.graph.size.nodes;
    if (first) { this.loading.hidden = false; this.loading.classList.remove("pnl-err"); }
    this.inflight = true;
    const r = await api.graph();
    if (gen !== this.graphGen) return;
    this.inflight = false;
    if (!r.ok) {
      if (first) { this.loading.classList.add("pnl-err"); this.loading.lastElementChild!.textContent = "Library offline"; }
      this.loadedAt = 0; // retry on next open, and every few seconds while open
      this.scheduleRefresh(4000);
      return;
    }
    this.loading.hidden = true;
    this.stats.hidden = false;
    this.graph.setData(r.nodes ?? [], r.edges ?? []);
    this.statPages.textContent = String(this.graph.size.nodes);
    this.statLinks.textContent = String(this.graph.size.edges);
    this.renderLegend();
    if (this.root.isConnected) this.renderFeed(); // titles may have arrived
  }

  private renderLegend(): void {
    this.legendEl.replaceChildren(...this.graph.types().map(([type, n]) =>
      h("span", { class: "pnl-chip-type" }, h("i", { style: `background:${TYPE_COLORS[type] ?? "#8b8f96"}` }), TYPE_LABELS[type] ?? type, h("b", {}, String(n)))));
  }

  /** Graph node label: unit ids become unit names ("Learning on LUM-105 by u5" -> "LUM-105 learning, Eno"). */
  private nodeLabel(id: string, title: string): string {
    const name = (uid: string) => this.store.unit(uid)?.name ?? `Agent ${uid.replace(/^u/, "")}`;
    const m = /^Learning(?: on (\S+))? by (u\d+)$/.exec(title || "");
    if (m) return m[1] ? `${m[1]} learning, ${name(m[2]!)}` : `Learning, ${name(m[2]!)}`;
    const u = /^Unit (u\d+)$/.exec(title || "");
    if (u) return name(u[1]!);
    const r = /^Rule:\s*(.+)$/.exec(title || ""); // the type tag already says Rule
    if (r) return r[1]![0]!.toUpperCase() + r[1]!.slice(1);
    return title || slugTitle(id);
  }

  private titleOf(slug: string): string { return this.graph.title(slug) ?? slugTitle(slug); }

  private async search(q: string): Promise<void> {
    const gen = ++this.searchGen;
    this.results.replaceChildren();
    if (!q.trim()) return;
    const r = await api.search(q.trim());
    if (gen !== this.searchGen) return;
    if (!r.ok) { this.results.append(h("p", { class: "pnl-err" }, r.error)); return; }
    const hits = Array.isArray(r.data) ? r.data : [];
    if (!hits.length) { this.results.append(h("p", { class: "pnl-empty" }, "No matches")); return; }
    for (const hit of hits.slice(0, 6)) {
      const type = this.graph.type(hit.slug);
      this.results.append(h("button", { class: "pnl-hit", onclick: () => this.openPage(hit.slug) },
        h("i", { class: "pnl-dot", style: `background:${TYPE_COLORS[type ?? ""] ?? "#8b8f96"}` }),
        h("span", { class: "pnl-hit-t" }, hit.title || this.titleOf(hit.slug)),
        hit.snippet ? h("span", { class: "pnl-snippet" }, hit.snippet) : null));
    }
  }

  async openPage(slug: string): Promise<void> {
    const gen = ++this.pageGen;
    this.graph.select(slug);
    this.pageBox.hidden = false;
    this.pageBox.classList.add("pnl-page-loading");
    const r = await api.page(slug);
    if (gen !== this.pageGen) return;
    this.pageBox.classList.remove("pnl-page-loading");
    const close = h("button", { class: "pnl-x", title: "Close page", onclick: () => this.closePage() }, icon("close"));
    if (!r.ok) {
      this.pageBox.replaceChildren(h("div", { class: "pnl-page-head" }, h("span", { class: "pnl-page-t" }, this.titleOf(slug)), close), h("p", { class: "pnl-err" }, r.error));
      return;
    }
    const type = this.graph.type(r.slug ?? slug);
    this.pageBox.replaceChildren(
      h("div", { class: "pnl-page-head" },
        type ? h("span", { class: "pnl-tag", style: `--tag:${TYPE_COLORS[type] ?? "#8b8f96"}` }, TYPE_LABELS[type] ?? type) : null,
        h("span", { class: "pnl-page-t", title: r.slug ?? slug }, r.title || this.titleOf(slug)), close),
      renderMarkdown(r.body ?? "", (s) => this.openPage(s)),
    );
  }

  private closePage(): void {
    this.pageGen++;
    this.pageBox.hidden = true;
    this.pageBox.replaceChildren();
    this.graph.select(null);
  }

  private renderFeed(): void {
    const recent = this.store.getState().memory.recent.slice(-24).reverse();
    this.feed.replaceChildren();
    if (!recent.length) { this.feed.append(h("p", { class: "pnl-empty" }, "No memories yet")); return; }
    const now = Date.now();
    for (const m of recent) {
      const who = m.unitId ? this.store.unit(m.unitId)?.name ?? `Agent ${m.unitId.replace(/^u/, "")}` : "Library";
      const slug = m.slugs[0];
      // A remembered learning reads "Cato learned from LUM-101"; other pages by their title.
      const learned = m.op === "remember" && !!slug?.startsWith("learnings/");
      const issue = learned ? /^learnings\/([a-z]+-\d+)-/.exec(slug!)?.[1]?.toUpperCase() : undefined;
      // Feed titles never name the author again ("LUM-108 learning", not "LUM-108 learning, Bram").
      const ft = (sl: string) => (sl.startsWith("learnings/") ? slugTitle(sl) : this.titleOf(sl));
      const link = m.op === "link" && m.slugs.length >= 2;
      const obj = learned ? issue ?? "a lesson" : link ? `${ft(m.slugs[0]!)} to ${ft(m.slugs[1]!)}` : slug ? ft(slug) : m.summary || "";
      const verb = m.op === "recall" ? "recalled" : learned ? (issue ? "learned from" : "learned") : m.op === "remember" ? "remembered" : "linked";
      const more = m.slugs.length > (link ? 2 : 1) ? ` +${m.slugs.length - (link ? 2 : 1)}` : "";
      this.feed.append(h("button", {
        class: `pnl-mem pnl-mem-${m.op}`, title: m.summary || "", disabled: !slug,
        onclick: () => { if (slug) this.openPage(slug); },
      },
        icon(m.op === "recall" ? "recall" : m.op === "remember" ? "remember" : "link"),
        h("span", { class: "pnl-mem-t" }, h("b", {}, who), ` ${verb} `, h("em", {}, obj), more),
        h("time", {}, ago(m.ts, now))));
    }
  }
}
