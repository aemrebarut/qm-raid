// Unit tests for src/qm.ts with a fetch fixture (no QM needed). Run: bun test test/qm.test.ts
import { afterEach, expect, test } from "bun:test";
import { waitRun } from "../src/qm.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fixture(states: unknown[]): { calls: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const body = states[Math.min(n, states.length - 1)];
    n++;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls: () => n };
}

test("waitRun polls through pending and running until done", async () => {
  const f = fixture([
    { status: "pending", result: null },
    { status: "running", result: null },
    { status: "done", result: { status: "ok", sessionId: "s1", reply: "hi" } },
  ]);
  const run = await waitRun("r1", 5_000, 1);
  expect(run.status).toBe("done");
  expect(run.result?.reply).toBe("hi");
  expect(f.calls()).toBe(3);
});

test("waitRun returns failed runs", async () => {
  fixture([{ status: "pending", result: null }, { status: "failed", result: { status: "failed", reason: "boom" } }]);
  const run = await waitRun("r2", 5_000, 1);
  expect(run.status).toBe("failed");
});
