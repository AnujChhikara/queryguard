import { describe, it, expect } from "vitest";
import { toVsDiagnostics } from "../src/analyze.js";

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
});
