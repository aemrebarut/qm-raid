// Regression: a delayed GET /api/state must not overwrite newer SSE state (review of b1a7c26).
import { test, expect } from "bun:test";
import { createStore, connectEngine, fixtureState } from "../src/core";

class FakeES {
  static last: FakeES;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeES.last = this; }
  close() {}
  emit(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

test("late GET /api/state is ignored after SSE", async () => {
  const g = globalThis as any;
  const origFetch = g.fetch, origES = g.EventSource;
  let resolveFetch!: (r: Response) => void;
  g.fetch = () => new Promise<Response>((r) => { resolveFetch = r; });
  g.EventSource = FakeES;
  try {
    const store = createStore(fixtureState());
    const stop = connectEngine(store);
    const snap = fixtureState();
    snap.units[0]!.pos = { x: 22, y: 22 };
    FakeES.last.emit({ seq: 1, ts: 1, type: "state.snapshot", state: snap });
    FakeES.last.emit({ seq: 2, ts: 2, type: "unit.status", unitId: "u1", status: "idle" });
    resolveFetch(new Response(JSON.stringify(fixtureState()), { status: 200 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(store.unit("u1")!.pos).toEqual({ x: 22, y: 22 });
    expect(store.unit("u1")!.status).toBe("idle");
    expect(store.connection).toBe("live");
    stop();
  } finally {
    g.fetch = origFetch;
    g.EventSource = origES;
  }
});
