// raid-look-panels: human titles never leak ids or epoch stamps; Forge scores parse as reported.
import { test, expect } from "bun:test";
import { slugTitle } from "../src/panels/library";
import { parseEval } from "../src/panels/forge";

test("slugTitle hides unit ids and epoch stamps", () => {
  expect(slugTitle("learnings/lum-101-u3-1790547859718")).toBe("LUM-101 learning");
  expect(slugTitle("learnings/dev-u1-1790547966120")).toBe("Learning");
  expect(slugTitle("learnings/lum-101-river-reviewer-1790547966120")).toBe("LUM-101 learning");
  expect(slugTitle("learnings/general-u1-1790547869528")).toBe("Learning");
  expect(slugTitle("issues/lum-101")).toBe("LUM-101");
  expect(slugTitle("rules/billing-idempotency")).toBe("Billing idempotency");
  for (const s of ["learnings/dev-u1-1790547966120", "notes/u7-scratch-1790547966120"]) expect(slugTitle(s)).not.toMatch(/\d{10}|\bu\d+\b/);
});

test("parseEval keeps the Forge's numbers, overall last", () => {
  const m = parseEval("ready: eval 0.66 vs base 0.73 (style 0.81 vs 0.81, grounded 0.52 vs 0.66; v1)")!;
  expect(m.map((x) => x.key)).toEqual(["style", "grounded", "overall"]);
  expect(m[2]).toMatchObject({ trained: 0.66, base: 0.73 });
  expect(parseEval("dry run: ready (no real training, no eval score)")).toBeNull();
});
