// Global feed: the last few lines of store.feed() across all units, bottom left above the panel.
import type { FeedEntry, Store } from "../core";
import { clear, h, timeOf } from "./dom";

const LINES = 6;
const ICON: Record<string, string> = {
  message: "\u{1F4AC}", tool: "\u{1F6E0}", thinking: "\u{1F4AD}", error: "⚠",
  recall: "\u{1F4D6}", remember: "\u{1F4DC}", order: "⚔", reply: "✉",
};

export class GlobalFeed {
  readonly root = h("ol", { class: "hud-gfeed" });
  private last: FeedEntry | undefined;

  constructor(private store: Store) {}

  render(): void {
    const all = this.store.feed();
    if (all.at(-1) === this.last) return;
    this.last = all.at(-1);
    clear(this.root);
    for (const e of all.slice(-LINES)) {
      const name = this.store.unit(e.unitId)?.name ?? e.unitId;
      this.root.append(h("li", { class: `hud-gfeed-${e.kind}` },
        h("span", { class: "hud-feed-time" }, timeOf(e.ts)),
        h("span", null, ICON[e.kind] ?? "•"),
        h("b", null, name),
        e.tool ? h("code", null, e.tool) : null,
        h("span", { class: "hud-gfeed-text" }, e.text),
      ));
    }
  }
}
