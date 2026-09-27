// Smoke: the package never imports board, contract or engine code, and every area file imports three only.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

test("art sources import only three and each other", () => {
  const root = join(import.meta.dir, "..");
  for (const f of [...files(join(root, "src")), ...files(join(root, "showroom"))]) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']/g)) {
      const spec = m[1];
      const ok = spec === "three" || spec.startsWith("three/") || spec.startsWith("./") || spec.startsWith("../src") || (spec.startsWith("../") && !/apps|board|contract|services/.test(spec));
      expect(ok, `${f} imports ${spec}`).toBe(true);
    }
  }
});
