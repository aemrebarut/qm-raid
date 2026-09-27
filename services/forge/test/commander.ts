// Offline commander test: a synthetic veto log where the user always cancels scouts on billing and
// adjusts them to search. The refit commander must stop proposing scout -> billing.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "forge-cmd-"));
process.env.VETO_LOG = join(dir, "vetoes.jsonl");
const { propose, commanderModel } = await import("../src/commander");
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };

const ctx = {
  units: [{ id: "s1", class: "scout", status: "idle", pos: { x: 5, y: 5 }, history: [] }],
  targets: [
    { id: "tb", component: "billing", severity: 3, kind: "bug", status: "open", pos: { x: 4, y: 4 } },
    { id: "ts", component: "search", severity: 2, kind: "bug", status: "open", pos: { x: 14, y: 14 } },
  ],
  memory: "",
};
const before = propose(ctx);
if (before[0]?.targetId !== "tb") fail(`prior should pick billing (severity 3, near): ${JSON.stringify(before)}`);

const rows = Array.from({ length: 8 }, (_, i) => JSON.stringify({ ts: i, proposal: { unitId: "s1", targetId: "tb", reason: "" }, context: ctx,
  action: i % 2 ? "cancel" : "adjust", adjustedTo: i % 2 ? undefined : { targetId: "ts" } }));
writeFileSync(process.env.VETO_LOG!, rows.join("\n") + "\n");
const after = propose(ctx);
const m = commanderModel();
console.log("examples", m.examples, "after", JSON.stringify(after));
if (after.some((p) => p.targetId === "tb")) fail("commander still proposes scout -> billing after 8 vetoes");
if (after[0]?.targetId !== "ts") fail("commander should prefer search after the adjusts");
console.log("PASS");
