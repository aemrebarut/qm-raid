// Spawn-issue dialog and target.spawned reducer.
import { test, expect } from "bun:test";

test("target.spawned upserts the target before subscribers run", async () => {
  const { createStore, fixtureState } = await import("../src/core");
  const store = createStore(fixtureState());
  const n = store.getState().targets.length;
  const seen: number[] = [];
  store.onEvent(() => seen.push(store.getState().targets.length));
  store.subscribe((s) => seen.push(s.targets.length));
  const target = { id: "t900", issue: "LUM-900", title: "New", component: store.getState().components[0].id, kind: "bug" as const, severity: 2 as const, status: "open" as const, pos: { x: 2, y: 2 }, customers: [] };
  store.apply({ seq: 1, ts: Date.now(), type: "target.spawned", target });
  expect(store.target("t900")?.issue).toBe("LUM-900");
  expect(seen).toEqual([n + 1, n + 1]);
});

test("new issue dialog: N toggles, Random posts {}, the form posts fields, Esc closes", async () => {
  const g = globalThis as any;
  const origFetch = g.fetch;
  const { Window } = await import("happy-dom");
  const win = new Window();
  g.document = win.document; g.window = win; g.HTMLElement = win.HTMLElement; g.Node = win.Node;
  const posts: any[] = [];
  g.fetch = async (url: string, init: any) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true, target: { id: "t901", issue: "LUM-901", title: "x", component: "billing", kind: "bug", severity: 2, status: "open", pos: { x: 3, y: 4 }, customers: [] } }));
  };
  try {
    const { mountNewIssue } = await import("../src/hud/newIssue");
    const { createStore, createBus, fixtureState } = await import("../src/core");
    const store = createStore(fixtureState());
    const bus = createBus();
    const toasts: string[] = [];
    const focus: any[] = [];
    bus.on("toast", (t) => toasts.push(t.text));
    bus.on("focusTile", (p) => focus.push(p));
    const hud = win.document.createElement("div");
    win.document.body.append(hud);
    const off = mountNewIssue(hud as any, store, bus);
    const dlg = hud.querySelector(".nix") as any;
    const key = (k: string, target: any = win.document.body) => target.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, bubbles: true }));
    expect(dlg.hidden).toBe(true);
    key("n");
    expect(dlg.hidden).toBe(false);
    expect(dlg.querySelectorAll("select")[0].options.length).toBe(store.getState().components.length + 1);

    // Random: one click, empty body
    (dlg.querySelector(".nix-btn") as any).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(posts[0]).toEqual({ url: "/api/targets", body: {} });
    expect(dlg.hidden).toBe(true);
    expect(toasts.at(-1)).toContain("LUM-901");
    expect(focus.at(-1)).toEqual({ x: 3, y: 4 });

    // Form: title, zone, kind, severity
    bus.newIssue();
    expect(dlg.hidden).toBe(false);
    const [zone, kind, sev] = dlg.querySelectorAll("select");
    dlg.querySelector("input").value = "Export drops the last row";
    zone.value = store.getState().components[1].id; kind.value = "feature"; sev.value = "3";
    dlg.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(posts[1].body).toEqual({ title: "Export drops the last row", component: store.getState().components[1].id, kind: "feature", severity: 3 });

    // Typing N inside the title field does not toggle; Esc closes
    key("n");
    expect(dlg.hidden).toBe(false);
    key("n", dlg.querySelector("input"));
    expect(dlg.hidden).toBe(false);
    key("Escape");
    expect(dlg.hidden).toBe(true);
    off();
  } finally { g.fetch = origFetch; }
});

test("new issue dialog: a late success keeps a newer draft (review P2 d31400a)", async () => {
  const g = globalThis as any;
  const origFetch = g.fetch;
  const { Window } = await import("happy-dom");
  const win = new Window();
  g.document = win.document; g.window = win; g.HTMLElement = win.HTMLElement; g.Node = win.Node;
  const pending: ((r: Response) => void)[] = [];
  g.fetch = () => new Promise<Response>((resolve) => pending.push(resolve));
  const ok = () => new Response(JSON.stringify({ ok: true, target: { id: "t902", issue: "LUM-902", title: "First issue", component: "billing", kind: "bug", severity: 2, status: "open", pos: { x: 1, y: 1 }, customers: [] } }));
  try {
    const { NewIssueDialog } = await import("../src/hud/newIssue");
    const { createStore, createBus, fixtureState } = await import("../src/core");
    const dlg = new NewIssueDialog(createStore(fixtureState()), createBus());
    win.document.body.append(dlg.root as any);
    const title = dlg.root.querySelector("input") as any;

    // Reopened with a new draft while the first request is in flight
    dlg.open(); title.value = "First issue";
    const first = dlg.submit();
    dlg.close(); dlg.open(); title.value = "Next issue draft";
    pending.shift()!(ok());
    expect((await first)?.issue).toBe("LUM-902");
    expect(dlg.isOpen).toBe(true);
    expect(title.value).toBe("Next issue draft");

    // Same view, draft edited during the request
    const second = dlg.submit();
    title.value = "Edited while sending";
    pending.shift()!(ok());
    await second;
    expect(dlg.isOpen).toBe(true);
    expect(title.value).toBe("Edited while sending");

    // Untouched: cleared and closed
    const third = dlg.submit();
    pending.shift()!(ok());
    await third;
    expect(dlg.isOpen).toBe(false);
    expect(title.value).toBe("");
  } finally { g.fetch = origFetch; }
});
