// Builds the World (contract/types.ts) from world/layout.json and the page files in world/brain/.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { World, Target, Customer } from "../../../contract/types.ts";

export const WORLD_DIR = resolve(import.meta.dir, "../../../world");
export const BRAIN_DIR = join(WORLD_DIR, "brain");

export function parsePage(text: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm, body: text };
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { fm, body: m[2] };
}

function readDir(sub: string): { slug: string; fm: Record<string, string>; body: string }[] {
  const dir = join(BRAIN_DIR, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => {
    const { fm, body } = parsePage(readFileSync(join(dir, f), "utf8"));
    return { slug: `${sub}/${f.slice(0, -3)}`, fm, body };
  });
}

export function loadWorld(): World {
  const layout = JSON.parse(readFileSync(join(WORLD_DIR, "layout.json"), "utf8"));
  const people = new Map(readDir("people").map((p) => [p.slug, p.fm.title]));
  const customers: Customer[] = readDir("companies").map((c) => {
    const contactSlug = c.body.match(/\[\[(people\/[^\]]+)\]\]/)?.[1] ?? "";
    return { id: c.slug.split("/")[1], name: c.fm.title, contact: people.get(contactSlug) ?? "", contactSlug, slug: c.slug };
  });
  const issues = new Map(readDir("issues").map((i) => [i.fm.issue, i]));
  const targets: Target[] = layout.targets.map((t: any) => {
    const i = issues.get(t.issue);
    if (!i) throw new Error(`layout target ${t.id} has no issue page for ${t.issue}`);
    const custIds = [...new Set([...i.body.matchAll(/\[\[companies\/([^\]]+)\]\]/g)].map((m) => m[1]))];
    return {
      id: t.id, issue: t.issue, title: i.fm.title.replace(/^[A-Z]+-\d+:\s*/, ""), component: i.fm.component,
      kind: i.fm.kind as Target["kind"], severity: Number(i.fm.severity) as Target["severity"],
      status: "open", pos: t.pos, customers: custIds,
    };
  });
  return { components: layout.components, buildings: layout.buildings, targets, customers };
}

export function issueSlug(issue: string): string {
  return `issues/${issue.toLowerCase()}`;
}
