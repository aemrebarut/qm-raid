// M1 smoke: one real QM turn through the local portal. Run: bun test/smoke.ts (env QM_PORTAL_URL, default http://localhost:8129)
import { PORTAL_URL, principal, startTurn, threadRefFor, waitRun } from "../src/qm.ts";

const t0 = Date.now();
const who = await principal();
const threadRef = await threadRefFor(`smoke-${Date.now()}`);
console.log(`portal ${PORTAL_URL} principal ${who} threadRef ${threadRef}`);

const { runId, status: queued } = await startTurn(threadRef, "Say hello in five words");
console.log(`turn ${queued} runId ${runId}`);

const run = await waitRun(runId);
const r = run.result;
console.log(`run status: ${run.status}`);
console.log(`status: ${r?.status}`);
console.log(`sessionId: ${r?.sessionId}`);
console.log(`reply: ${r?.reply ?? r?.message ?? r?.error}`);
console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(r?.status === "ok" && r.reply ? 0 : 1);
