// Loadout view: changed fields only, applying/applied states, late replies, engine updates during edits.
import { test, expect } from "bun:test";

const CATALOG = { items: [
  { id: "raid-board", name: "Raid board", description: "Order header format", kind: "skill" },
  { id: "test-writer", name: "Test writer", description: "Regression tests first", kind: "skill" },
  { id: "gbrain", name: "GBrain", description: "Team memory", kind: "plugin" },
  { id: "linear", name: "Linear", description: "Issue tracker", kind: "plugin" },
] };

async function setup() {
  const g = globalThis as any;
  const { Window } = await import("happy-dom");
  const win = new Window();
  g.document = win.document; g.window = win; g.HTMLElement = win.HTMLElement; g.Node = win.Node;
  const patches: { url: string; body: any; resolve: (r: Response) => void }[] = [];
  g.fetch = (url: string, init: any) => {
    if (url === "/api/catalog") return Promise.resolve(new Response(JSON.stringify(CATALOG)));
    return new Promise<Response>((resolve) => patches.push({ url, body: JSON.parse(init.body), resolve }));
  };
  const { LoadoutView } = await import("../src/hud/loadout");
  const { createStore, createBus, fixtureState } = await import("../src/core");
  const store = createStore(fixtureState());
  const view = new LoadoutView(store, createBus());
  win.document.body.append(view.root as any);
  const tick = () => new Promise((r) => setTimeout(r, 5));
  return { win, store, view, patches, tick };
}

test("loadout: Apply sends only the changed fields and shows applying then applied", async () => {
  const orig = (globalThis as any).fetch;
  try {
    const { store, view, patches, tick } = await setup();
    view.show("u1");
    await tick();
    const root = view.root;
    const apply = () => [...root.querySelectorAll("button")].find((b) => b.textContent === "Apply" || b.textContent === "Applying") as any;
    expect(apply().disabled).toBe(true);
    const box = (name: string) => [...root.querySelectorAll(".ldo-item")].find((l) => l.textContent!.includes(name))!.querySelector("input") as any;
    expect(box("GBrain").checked).toBe(true);
    box("Test writer").checked = true; box("Test writer").dispatchEvent(new (globalThis as any).window.Event("change"));
    ([...root.querySelectorAll(".ldo-chip")].find((c) => c.textContent === "Brief") as any).click();
    (root.querySelector('[data-effort="xhigh"]') as any).click();
    expect(apply().disabled).toBe(false);

    const done = view.apply();
    expect(apply().textContent).toBe("Applying");
    expect(patches[0].url).toBe("/api/units/u1");
    expect(Object.keys(patches[0].body).sort()).toEqual(["effort", "instructions", "skills"]);
    expect(patches[0].body.skills).toEqual(["raid-board", "test-writer"]);
    expect(patches[0].body.instructions).toContain("Keep replies under 120 words");
    const unit = { ...store.unit("u1")!, effort: "xhigh", loadout: { instructions: patches[0].body.instructions, skills: patches[0].body.skills, plugins: ["gbrain"] } };
    patches[0].resolve(new Response(JSON.stringify({ ok: true, unit })));
    expect(await done).toBe(true);
    expect(root.querySelector(".ldo-status")!.textContent).toBe("Applied");
    expect(apply().disabled).toBe(true);
  } finally { (globalThis as any).fetch = orig; }
});

test("loadout: a late reply for another unit and engine updates during edits leave the draft alone", async () => {
  const orig = (globalThis as any).fetch;
  try {
    const { store, view, patches, tick } = await setup();
    view.show("u1");
    await tick();
    const text = view.root.querySelector("textarea") as any;
    text.value = "Only billing."; text.dispatchEvent(new (globalThis as any).window.Event("input"));
    const first = view.apply();
    view.show("u2"); // switch before the reply
    patches[0].resolve(new Response(JSON.stringify({ ok: true })));
    await first;
    expect(view.root.querySelector(".ldo-status")!.textContent).toBe("");
    expect((view.root.querySelector("textarea") as any).value).toBe(store.unit("u2")!.loadout!.instructions);

    // Dirty draft on u2, then the engine updates u2: the draft stays and diffs against the new base
    const t2 = view.root.querySelector("textarea") as any;
    t2.value = "Draft in progress"; t2.dispatchEvent(new (globalThis as any).window.Event("input"));
    store.apply({ seq: 5, ts: Date.now(), type: "unit.updated", unit: { ...store.unit("u2")!, effort: "low" } });
    expect((view.root.querySelector("textarea") as any).value).toBe("Draft in progress");
    expect(view.dirty).toBe(true);
    t2.value = "Draft after the update"; t2.dispatchEvent(new (globalThis as any).window.Event("input")); // same controls, new draft object
    view.apply();
    expect(patches[1].body).toEqual({ instructions: "Draft after the update" }); // effort came from the engine, not the draft
  } finally { (globalThis as any).fetch = orig; }
});

test("loadout: GBrain is locked on, and plugins sent always include it", async () => {
  const orig = (globalThis as any).fetch;
  try {
    const { store, view, patches, tick } = await setup();
    store.apply({ seq: 7, ts: Date.now(), type: "unit.updated", unit: { ...store.unit("u3")!, loadout: { instructions: "", skills: [], plugins: [] } } });
    view.show("u3");
    await tick();
    const row = (name: string) => [...view.root.querySelectorAll(".ldo-item")].find((l) => l.textContent!.includes(name))!;
    const gb = row("GBrain").querySelector("input") as any;
    expect(gb.checked).toBe(true);
    expect(gb.disabled).toBe(true);
    expect(row("GBrain").textContent).toContain("The Library: always on");
    expect(view.dirty).toBe(false); // an engine loadout without gbrain is not a pending change
    const lin = row("Linear").querySelector("input") as any;
    lin.checked = true; lin.dispatchEvent(new (globalThis as any).window.Event("change"));
    view.apply();
    expect(patches[0].body).toEqual({ plugins: ["gbrain", "linear"] });
  } finally { (globalThis as any).fetch = orig; }
});
