import { describe, it, expect } from "vitest";
import { analyzeSource } from "../src/engine.js";

describe("analyzeSource", () => {
  it("reports n-plus-one for a prisma query in a loop", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        const users = [];
        for (const id of ids) {
          users.push(await prisma.user.findUnique({ where: { id } }));
        }
        return users;
      }
    `);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
  });

  it("reports nothing for a batched query", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        return prisma.user.findMany({ where: { id: { in: ids } } });
      }
    `);
    expect(diags).toHaveLength(0);
  });

  it("does not throw on unparsable input", () => {
    expect(() => analyzeSource("const x = ")).not.toThrow();
  });
});
