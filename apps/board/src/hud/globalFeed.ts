// Global feed: the last few events across all units, bottom left above the panel.
// One line each: icon, name, short verb phrase, object ("Bram recalled Billing Idempotency"), relative time.
import type { Bus, FeedEntry, Store } from "../core";
import { icon, kindIcon } from "../theme/icons";
import { firstLine, humanize, orderPhrase, pageTitle, refreshTimes, relTime, stripName, toolPhrase } from "../theme/text";
import { h, RowList } from "./dom";

const LINES = 5;

export class GlobalFeed {
  readonly root = h("ol", { class: "hud-gfeed" });
  private last: FeedEntry | undefined;
  private rows = new RowList<FeedEntry>(this.root, (e) => this.row(e));

  constructor(private store: Store, private bus: Bus) {
    setInterval(() => refreshTimes(this.root), 5000);
  }

  render(): void {
    const all = this.store.feed();
    if (all.at(-1) === this.last) return;
    this.last = all.at(-1);
    // A handoff is logged on both units; show it once, from the sender. Thinking stays in the unit panel.
    this.rows.set(all.filter((e) => e.kind !== "thinking" && !(e.kind === "handoff" && e.text.startsWith("received from"))).slice(-LINES));
    refreshTimes(this.root);
  }

  private row(e: FeedEntry): HTMLElement {
    const name = this.store.unit(e.unitId)?.name ?? e.unitId;
    const slug = e.slugs?.find((x) => typeof x === "string" && x);
    const [verb, obj] = phrase(e, name, slug);
    return h("li", { class: `hud-gfeed-${e.kind}`, title: e.text },
      h("span", { class: "hud-feed-time", "data-ts": e.ts }, relTime(e.ts)),
      h("span", { class: "hud-gfeed-icon" }, icon(kindIcon(e.kind))),
      h("b", null, name),
      h("span", { class: "hud-gfeed-text" }, verb ? `${verb} ` : "", obj ? h("span", { class: "hud-gfeed-obj" }, obj) : null),
      slug ? h("button", { class: "hud-chip", type: "button", title: "Open in the Library", onclick: () => this.bus.openPage(slug) }, icon("page")) : null,
    );
  }
}

function phrase(e: FeedEntry, name: string, slug: string | undefined): [string, string] {
  const text = humanize(firstLine(stripName(e.text, name)));
  switch (e.kind) {
    case "recall": return ["recalled", slug ? pageTitle(slug) : text];
    case "remember": return ["remembered", slug ? pageTitle(slug) : text];
    case "handoff": return ["", text.replace(/:.*$/, "")];
    case "tool": return ["", toolPhrase(e.tool, e.text, e.slugs)];
    case "order": return ["", orderPhrase(e.text)];
    case "reply": return ["", text];
    case "error": return ["failed", text];
    default: return ["", text];
  }
}
