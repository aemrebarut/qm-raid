// Tails a pipeline child's progress.jsonl into its type record. Reads everything already written before judging
// the child: a run that finished while the forge was down replays to ready (or failed) instead of "interrupted".
export interface Tracked { id: string; status: string; stage: string; pid?: number | null }

export async function followProgress(t: Tracked, file: string, deps: { alive: (pid?: number | null) => boolean; save: () => void; pollMs?: number }) {
  const { alive, save } = deps;
  let offset = 0, buf = "";
  const decoder = new TextDecoder();
  while (true) {
    const done = !alive(t.pid);
    try {
      const f = Bun.file(file);
      if (f.size > offset) {
        buf += decoder.decode(new Uint8Array(await f.slice(offset).arrayBuffer()), { stream: true });
        offset = f.size;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const u = JSON.parse(line);
            for (const k of ["status", "progress", "stage", "examples", "evalScore", "model", "baseModel"] as const) {
              if (k in u) (t as any)[k] = u[k];
            }
          } catch { console.error("[forge] bad pipeline line", line.slice(0, 200)); }
        }
        save();
      }
    } catch {}
    if (t.status === "ready" || t.status === "failed") break;
    if (done) { Object.assign(t, { status: "failed", stage: "pipeline exited without finishing (or was interrupted by a forge restart)" }); break; }
    await Bun.sleep(deps.pollMs ?? 700);
  }
  t.pid = null;
  save();
  console.log(`[forge] type ${t.id} finished: ${t.status} (${t.stage})`);
}
