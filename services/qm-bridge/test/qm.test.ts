// Unit tests for src/qm.ts with a fetch fixture (no QM needed). Run: bun test test/qm.test.ts
import { afterEach, expect, test } from "bun:test";
import { waitRun } from "../src/qm.ts";
import { normalizeTool, toolArgs } from "../src/tools.ts";

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

test("gbrain MCP tool calls normalize to gbrain.<op> with flat args", () => {
  const qmArgs = { mcpServer: "gbrain", args: { unitId: "u1", targetId: "t12", componentId: "billing" } };
  expect(normalizeTool("gbrain_recall", qmArgs)).toBe("gbrain.recall");
  expect(normalizeTool("gbrain.recall", qmArgs)).toBe("gbrain.recall");
  expect(normalizeTool("mcp__gbrain__get_page", {})).toBe("gbrain.get_page");
  expect(toolArgs(qmArgs)).toEqual({ unitId: "u1", targetId: "t12", componentId: "billing" });
  expect(normalizeTool("skills", { action: "read", name: "onboarding" })).toBe("skills.read");
  expect(toolArgs({ action: "read" })).toEqual({ action: "read" });
});

test("GET retries once on 5xx", async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    return n === 1 ? new Response("boom", { status: 502 }) : new Response(JSON.stringify({ status: "done", result: { status: "ok" } }));
  }) as unknown as typeof fetch;
  const run = await waitRun("r3", 5_000, 1);
  expect(run.status).toBe("done");
  expect(n).toBe(2);
});
