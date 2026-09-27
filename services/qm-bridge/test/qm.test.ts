// Unit tests for src/qm.ts, src/tools.ts and src/loadout.ts with fetch fixtures (no QM needed). Run: bun test test/qm.test.ts
import { afterEach, expect, test } from "bun:test";
import { waitRun } from "../src/qm.ts";
import { normalizeTool, toolArgs } from "../src/tools.ts";
import { fetchCatalog, lastWebPost, loadoutLines, loadoutMarker, normalizeLoadout, soulContent, soulMarker, soulWritten } from "../src/loadout.ts";

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

test("loadout: normalize, marker turn and order-header lines", () => {
  expect(normalizeLoadout("x")).toBeNull();
  expect(normalizeLoadout({ instructions: "x", skills: [], plugins: [] })!.plugins).toEqual(["gbrain"]); // locked on
  const l = normalizeLoadout({ instructions: "  Always write the test first.  ", skills: ["raid-board", "raid-board", 3, ""], plugins: ["gbrain"] })!;
  expect(l).toEqual({ instructions: "Always write the test first.", skills: ["raid-board"], plugins: ["gbrain"] });
  expect(loadoutMarker(l)).toContain("Loadout changed. Standing orders from now on: Always write the test first.");
  expect(loadoutMarker(l)).toContain("Plugins: use only gbrain (GBrain always on)");
  expect(loadoutLines(l)).toEqual(["Standing orders: Always write the test first.", "Loadout: skills raid-board | plugins gbrain"]);
  expect(loadoutLines(undefined)).toEqual([]);
  const long = loadoutLines({ instructions: "x".repeat(900), skills: [], plugins: [] });
  expect(long).toHaveLength(1);
  expect(long[0]!.length).toBeLessThan(830);
});

test("catalog: QM skills (by name) plus GBrain when QM lists no MCP servers; fixed fallback when QM is down", async () => {
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith("/api/skills"))
      return new Response(
        JSON.stringify({
          skills: [
            { id: "u1", name: "memory", description: "Search your memory. More text.", status: "published", shadowed: false },
            { id: "u2", name: "raid-board", description: "Work as a unit.", status: "published", shadowed: false },
            { id: "u3", name: "old", description: "Shadowed.", status: "published", shadowed: true },
          ],
        }),
      );
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }) as unknown as typeof fetch;
  const items = await fetchCatalog();
  expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(["skill:raid-board", "skill:memory", "plugin:gbrain"]);
  expect(items[1]!.description).toBe("Search your memory.");
  expect(items[2]!.description).toBe("The Library: always on");
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  expect((await fetchCatalog()).map((i) => i.id)).toEqual(["raid-board", "gbrain"]);
});

test("plan B: SOUL marker decodes to the loadout, silent reply = last web post, SOUL write needs HTTP 200", () => {
  const l = { instructions: `Begin every reply with HALBERD. It's "quoted".`, skills: ["raid-board"], plugins: [] };
  const cmd = soulMarker(l).split("\n").find((x) => x.startsWith("echo "))!;
  expect(cmd).toContain('"$AGENT_API_URL/v1/soul"');
  expect(cmd).toContain('x-agent-capability: $AGENT_API_TOKEN'); // env names only, no values
  const content = JSON.parse(Buffer.from(cmd.split(" ")[1]!, "base64").toString()).content;
  expect(content).toBe(soulContent(l));
  expect(content).toContain(`It's "quoted".`);
  const post = (text: string) => ({ type: "tool_call", payload: { tool: "web", action: "post", text } });
  expect(lastWebPost([post("first"), { type: "tool_call", payload: { tool: "finish_silently" } }, post("HALBERD, hello")])).toBe("HALBERD, hello");
  expect(lastWebPost([])).toBeNull();
  const exec = (stdout: string) => ({ type: "tool_result", payload: { tool: "execute", stdout } });
  expect(soulWritten([exec('{"ok":true,"version":2}\nHTTP 200\n')])).toBe(true);
  expect(soulWritten([exec('{"error":"forbidden"}\nHTTP 403\n')])).toBe(false);
  expect(soulWritten(undefined)).toBe(false);
});
