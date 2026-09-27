// E18 restart safety: the game snapshot goes to STATE_FILE about 1 s after any change (temp file + rename, so a
// crash never leaves half a file) and is read back at boot. game.ts decides what goes in and how it is restored.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { STATE_FILE, STATE_MAX_AGE_MS } from "./config.ts";
import { logOnce } from "./http.ts";
import { currentSeq } from "./store.ts";

export interface SavedFile<T> { version: 1; savedAt: number; game: T }

// The saved game, or null when disabled, missing, unreadable or older than STATE_MAX_AGE_MS.
export function readSaved<T>(): SavedFile<T> | null {
  if (!STATE_FILE) return null;
  let raw: string;
  try { raw = readFileSync(STATE_FILE, "utf8"); } catch { return null; }
  try {
    const f = JSON.parse(raw) as SavedFile<T>;
    if (f?.version !== 1 || typeof f.savedAt !== "number" || !f.game) throw new Error("unknown format");
    const age = Date.now() - f.savedAt;
    if (age > STATE_MAX_AGE_MS) { console.log(`[engine] ${STATE_FILE} is ${Math.round(age / 60000)} min old; starting fresh`); return null; }
    return f;
  } catch (err) {
    console.warn(`[engine] ignoring ${STATE_FILE}: ${String(err).slice(0, 120)}`);
    return null;
  }
}

let snapshot: (() => unknown | null) | null = null;
let savedSeq = -1;
let writing = false;

function content(): string | null {
  const game = snapshot?.();
  return game ? JSON.stringify({ version: 1, savedAt: Date.now(), game } satisfies SavedFile<unknown>) : null;
}

// Writes now unless a write is running (the next check picks the change up). A null snapshot (reset running) skips.
export async function saveNow(): Promise<void> {
  if (!STATE_FILE || !snapshot || writing) return;
  const seq = currentSeq();
  const text = content();
  if (!text) return;
  writing = true;
  try {
    await mkdir(dirname(STATE_FILE), { recursive: true });
    await writeFile(`${STATE_FILE}.tmp`, text);
    await rename(`${STATE_FILE}.tmp`, STATE_FILE);
    savedSeq = seq;
  } catch (err) {
    logOnce("statefile", `cannot write ${STATE_FILE}: ${err}`);
  } finally {
    writing = false;
  }
}

// On exit (SIGTERM, SIGINT): one last synchronous write.
export function saveSync(): void {
  if (!STATE_FILE || !snapshot) return;
  try {
    const text = content();
    if (!text) return;
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(`${STATE_FILE}.tmp`, text);
    renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (err) {
    console.error(`[engine] cannot write ${STATE_FILE} on exit: ${err}`);
  }
}

// Every second: save when an event was emitted since the last save (every state change emits one).
// Returns a stop function (tests).
export function startSaving(fn: () => unknown | null): () => void {
  if (!STATE_FILE) { console.log("[engine] STATE_FILE=0: game state is not saved"); return () => {}; }
  snapshot = fn;
  savedSeq = currentSeq();
  const timer = setInterval(() => { if (currentSeq() !== savedSeq) void saveNow(); }, 1000);
  return () => { clearInterval(timer); snapshot = null; };
}
