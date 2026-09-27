// Offline test (reviewer P2): a pipeline that finished while the forge was down replays to ready, not "interrupted".
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followProgress, type Tracked } from "../src/progress";

const dir = mkdtempSync(join(tmpdir(), "forge-progress-"));
const fail = (m: string) => { console.error("FAIL", m); process.exit(1); };
const line = (o: object) => JSON.stringify(o) + "\n";
const dead = () => false, save = () => {};

// 1. Child exited during downtime after writing ready: replay keeps the model and score.
const f1 = join(dir, "a.jsonl");
writeFileSync(f1, line({ status: "training", progress: 0.5, stage: "sft" }) + line({ status: "ready", progress: 1, stage: "ready", model: "river://ckpt", evalScore: 0.82 }));
const a: Tracked = { id: "a", status: "training", stage: "sft", pid: 999999 };
await followProgress(a, f1, { alive: dead, save });
if (a.status !== "ready" || (a as any).model !== "river://ckpt" || (a as any).evalScore !== 0.82) fail(`replay: ${JSON.stringify(a)}`);

// 2. Child exited mid-run: failed, with a reason.
const f2 = join(dir, "b.jsonl");
writeFileSync(f2, line({ status: "training", progress: 0.4, stage: "sft" }));
const b: Tracked = { id: "b", status: "training", stage: "", pid: 999999 };
await followProgress(b, f2, { alive: dead, save });
if (b.status !== "failed" || !b.stage) fail(`dead mid-run: ${JSON.stringify(b)}`);

// 3. Live child: keeps tailing until the terminal line lands.
const f3 = join(dir, "c.jsonl");
writeFileSync(f3, line({ status: "evaluating", progress: 0.9, stage: "eval" }));
let live = true;
const c: Tracked = { id: "c", status: "generating", stage: "", pid: 1 };
const p = followProgress(c, f3, { alive: () => live, save, pollMs: 20 });
await Bun.sleep(100);
if (c.status !== "evaluating") fail(`tail: ${JSON.stringify(c)}`);
appendFileSync(f3, line({ status: "ready", progress: 1, stage: "ready", model: "river://c" }));
live = false;
await p;
if (c.status !== "ready" || c.pid !== null) fail(`tail end: ${JSON.stringify(c)}`);
console.log("PASS");
