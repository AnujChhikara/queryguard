import { describe, it, expect } from "vitest";
import { parseKnowledge, parseConfig } from "@cardinal/core";
import { toVsDiagnostics } from "../src/analyze.js";

const KNOWLEDGE = parseKnowledge(
  `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
  "/p",
);

const SMALL_LOOP = `async function r(prisma){
  const active = await prisma.user.findMany({ where: { status: "active" } });
  for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
}`;

const N_PLUS_ONE = `
const users = await prisma.user.findMany({ where: { active: true } })
for (const user of users) {
  const posts = await prisma.post.findMany({ where: { authorId: user.id } })
}
`;

const CLEAN = `const users = await prisma.user.findMany({ where: { id: 1 }, include: { posts: true } })`;
const BROKEN = "const = = = @@@ (";

describe("toVsDiagnostics", () => {
  it("flags an N+1 loop with one error diagnostic", () => {
    const diags = toVsDiagnostics(N_PLUS_ONE, "bad.ts");
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].startOffset).toBeGreaterThanOrEqual(0);
    expect(diags[0].endOffset).toBeGreaterThan(diags[0].startOffset);
    expect(diags[0].endOffset).toBeLessThanOrEqual(N_PLUS_ONE.length);
  });

  it("returns no diagnostics for a clean single query", () => {
    expect(toVsDiagnostics(CLEAN, "good.ts")).toEqual([]);
  });

  it("returns [] for malformed code instead of throwing", () => {
    expect(() => toVsDiagnostics(BROKEN, "broken.ts")).not.toThrow();
    expect(toVsDiagnostics(BROKEN, "broken.ts")).toEqual([]);
  });

  it("flags n-plus-one over an untraceable set without knowledge", () => {
    expect(toVsDiagnostics(SMALL_LOOP, "a.ts").some((d) => d.ruleId === "n-plus-one")).toBe(true);
  });

  it("silences n-plus-one when knowledge proves the driving set small", () => {
    expect(toVsDiagnostics(SMALL_LOOP, "a.ts", KNOWLEDGE).some((d) => d.ruleId === "n-plus-one")).toBe(false);
  });

  it("drops a diagnostic for a rule turned off in config", () => {
    const config = parseConfig(`{ "rules": { "n-plus-one": "off" } }`, "/p");
    expect(toVsDiagnostics(N_PLUS_ONE, "a.ts", null, config).some((d) => d.ruleId === "n-plus-one")).toBe(false);
  });
});
