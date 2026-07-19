// Seed corpus case: a Prisma relation filter (`where: { posts: {...} }`) must
// not trip unindexed-query — the filter field is a relation, not a column.
import { describe, it, expect } from "vitest";
import { analyzeSource } from "../../src/engine.js";
import { parsePrismaSchema } from "../../src/schema/prisma.js";

const schema = parsePrismaSchema(
  "model User {\n  id Int @id\n  name String\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n}",
  "/p/schema.prisma",
);

describe("corpus: relation filter is not an unindexed column", () => {
  it("stays silent", () => {
    const diags = analyzeSource(
      `async function f(p){ return p.user.findMany({ where: { posts: { some: { id: 1 } } } }); }`,
      "f.ts",
      null,
      null,
      schema,
    );
    expect(diags.filter((d) => d.ruleId === "unindexed-query")).toHaveLength(0);
  });
});
