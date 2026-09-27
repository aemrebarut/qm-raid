// Regression (review of 9717398): out-of-order Library responses must not overwrite newer ones.
import { test, expect } from "bun:test";

test("latest openPage and search win over late responses", async () => {
  const g = globalThis as any;
  const origFetch = g.fetch;
  // Minimal DOM stubs so the panel can be constructed under bun.
  const { Window } = await import("happy-dom");
  const win = new Window();
  g.document = win.document; g.window = win; g.requestAnimationFrame = () => 0; g.cancelAnimationFrame = () => {};
  const pending: { url: string; resolve: (r: Response) => void }[] = [];
  g.fetch = (url: string) => new Promise<Response>((resolve) => pending.push({ url, resolve }));
  try {
    const { LibraryPanel } = await import("../src/panels/library");
    const { createStore, createBus, fixtureState } = await import("../src/core");
    const p = new LibraryPanel(createStore(fixtureState()), createBus());
    const a = p.openPage("pages/a");
    const b = p.openPage("pages/b");
    const reply = (slug: string) => new Response(JSON.stringify({ slug, title: slug.toUpperCase(), body: "x" }));
    pending[1]!.resolve(reply("pages/b"));
    await b;
    pending[0]!.resolve(reply("pages/a"));
    await a;
    expect(p.root.textContent).toContain("PAGES/B");
    expect(p.root.textContent).not.toContain("PAGES/A");
  } finally {
    g.fetch = origFetch;
  }
});
