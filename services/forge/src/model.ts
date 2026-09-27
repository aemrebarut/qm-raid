// Long-lived Python child (river/forge/serve.py) that answers forge unit prompts, JSON lines over stdio.
import { join } from "node:path";

export interface AskRequest {
  typeId: string; name: string; description: string; model: string; baseModel: string | null;
  order: string; context: string; targetId?: string;
}

type Pending = { resolve: (t: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export function createModelServer(riverDir: string, timeoutMs = 120_000) {
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  const pending = new Map<string, Pending>();
  let seq = 0;

  function start() {
    const p = Bun.spawn([join(riverDir, ".venv/bin/python"), "-m", "forge.serve"], {
      cwd: riverDir, stdin: "pipe", stdout: "pipe", stderr: "inherit", env: process.env,
    });
    proc = p;
    (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of p.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const m = JSON.parse(line) as { id: string; text?: string; error?: string };
            const w = pending.get(m.id);
            if (!w) continue;
            pending.delete(m.id);
            clearTimeout(w.timer);
            m.error ? w.reject(new Error(m.error)) : w.resolve(m.text ?? "");
          } catch { console.error("[forge] bad serve line", line.slice(0, 200)); }
        }
      }
    })().catch((e) => console.error("[forge] serve reader", e));
    p.exited.then((code) => {
      console.error(`[forge] model server exited (${code}); restarts on the next request`);
      if (proc === p) proc = null;
      for (const [id, w] of pending) { clearTimeout(w.timer); w.reject(new Error("model server exited")); pending.delete(id); }
    });
  }

  return {
    ask(req: AskRequest): Promise<string> {
      if (!proc) start();
      const id = `r${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("model timed out")); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        const sink = proc!.stdin as import("bun").FileSink;
        sink.write(JSON.stringify({ id, ...req }) + "\n");
        sink.flush();
      });
    },
    stop() { proc?.kill(); },
  };
}
