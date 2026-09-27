// Library (GBrain) panel: knowledge graph, search, page view with wikilinks, and the live memory feed.
import { api, type Store, type Bus, type EngineEvent } from "../core";
import { h, renderMarkdown } from "./el";
import { GraphView, legend } from "./graph";

export class LibraryPanel {
  readonly root: HTMLElement;
  private graph: GraphView;
  private pageBox: HTMLElement;
  private results: HTMLElement;
  private feed: HTMLElement;
  private status: HTMLElement;
  private loadedAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  // Request generations: a response is applied only if no newer request of the same kind started since.
  private pageGen = 0;
  private searchGen = 0;
  private graphGen = 0;

  constructor(private store: Store, private bus: Bus) {
    this.graph = new GraphView((slug) => this.openPage(slug));
    this.pageBox = h("div", { class: "pnl-page" }, h("p", { class: "pnl-hint" }, "Click a node, a search hit or a memory to read its page."));
    this.results = h("div", { class: "pnl-results" });
    this.feed = h("div", { class: "pnl-feed" });
    this.status = h("span", { class: "pnl-sub" });
    const input = h("input", { class: "pnl-input", placeholder: "Search the Library (e.g. idempotency)", type: "search" });
    const form = h("form", { class: "pnl-search", onsubmit: (e: Event) => { e.preventDefault(); this.search(input.value); } }, input, h("button", { class: "pnl-btn", type: "submit" }, "Search"));

    this.root = h("div", { class: "pnl-body pnl-library" },
      h("div", { class: "pnl-col pnl-col-graph" }, h("div", { class: "pnl-graph-wrap" }, this.graph.canvas), legend(), this.status),
      h("div", { class: "pnl-col pnl-col-side" },
        form, this.results,
        h("h3", {}, "Page"), this.pageBox,
        h("h3", {}, "Memory feed"), this.feed),
    );
  }

  show(): void {
    if (Date.now() - this.loadedAt > 5000) this.loadGraph();
    this.renderFeed();
    this.graph.start();
  }

  /** The whole state was replaced (fixture to live, reconnect, reset): refresh everything shown. */
  onReset(): void {
    if (!this.root.isConnected) { this.loadedAt = 0; return; }
    this.loadGraph();
    this.renderFeed();
  }

  onEvent(ev: EngineEvent): void {
    if (ev.type === "memory.recall") this.graph.flash(ev.slugs, "#5aa0ff");
    else if (ev.type === "memory.remember") {
      this.graph.flash([ev.slug], "#ffd24a");
      this.scheduleRefresh(); // new learning pages join the graph
    } else if (ev.type === "memory.link") this.graph.flash([ev.from, ev.to], "#ffd24a");
    else return;
    if (this.root.isConnected) this.renderFeed();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => { this.refreshTimer = null; if (this.root.isConnected) this.loadGraph(); }, 1500);
  }

  private async loadGraph(): Promise<void> {
    this.loadedAt = Date.now();
    const gen = ++this.graphGen;
    const r = await api.graph();
    if (gen !== this.graphGen) return;
    if (!r.ok) { this.status.textContent = `Graph unavailable: ${r.error}`; return; }
    this.graph.setData(r.nodes ?? [], r.edges ?? []);
    this.status.textContent = `${r.nodes?.length ?? 0} pages, ${r.edges?.length ?? 0} links`;
  }

  private async search(q: string): Promise<void> {
    const gen = ++this.searchGen;
    this.results.replaceChildren();
    if (!q.trim()) return;
    const r = await api.search(q.trim());
    if (gen !== this.searchGen) return;
    if (!r.ok) { this.results.append(h("p", { class: "pnl-err" }, r.error)); return; }
    const hits = Array.isArray(r.data) ? r.data : [];
    if (!hits.length) { this.results.append(h("p", { class: "pnl-hint" }, "No pages match.")); return; }
    for (const hit of hits.slice(0, 8)) {
      this.results.append(h("button", { class: "pnl-hit", onclick: () => this.openPage(hit.slug) },
        h("b", {}, hit.title || hit.slug), h("span", { class: "pnl-sub" }, ` ${hit.slug}`),
        hit.snippet ? h("div", { class: "pnl-snippet" }, hit.snippet) : null));
    }
  }

  async openPage(slug: string): Promise<void> {
    const gen = ++this.pageGen;
    this.graph.select(slug);
    this.pageBox.replaceChildren(h("p", { class: "pnl-hint" }, `Loading ${slug}...`));
    const r = await api.page(slug);
    if (gen !== this.pageGen) return;
    if (!r.ok) { this.pageBox.replaceChildren(h("p", { class: "pnl-err" }, `${slug}: ${r.error}`)); return; }
    this.pageBox.replaceChildren(
      h("div", { class: "pnl-page-head" }, h("b", {}, r.title || slug), h("span", { class: "pnl-sub" }, ` ${r.slug ?? slug}`)),
      renderMarkdown(r.body ?? "", (s) => this.openPage(s)),
    );
  }

  private renderFeed(): void {
    const recent = this.store.getState().memory.recent.slice(-30).reverse();
    this.feed.replaceChildren();
    if (!recent.length) { this.feed.append(h("p", { class: "pnl-hint" }, "No recalls or learnings yet.")); return; }
    for (const m of recent) {
      const who = this.store.unit(m.unitId)?.name ?? (m.unitId || "brain");
      const icon = m.op === "recall" ? "📖" : m.op === "remember" ? "✨" : "🔗";
      const time = new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      this.feed.append(h("div", { class: `pnl-mem pnl-mem-${m.op}` },
        h("span", { class: "pnl-sub" }, `${time} `), `${icon} ${who} ${m.op === "recall" ? "recalled" : m.op === "remember" ? "remembered" : "linked"}: `,
        m.summary || "",
        h("div", {}, ...m.slugs.slice(0, 4).map((s) => h("a", { class: "pnl-link pnl-chip", href: "#", onclick: (e: Event) => { e.preventDefault(); this.openPage(s); } }, s)))));
    }
  }
}
