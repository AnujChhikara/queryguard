import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parsePrismaSchema } from "../../src/schema/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { unindexedQueryRule } from "../../src/rules/unindexed-query.js";
import type { QueryDescriptor } from "../../src/types.js";

const schema = parsePrismaSchema(
  `model User {
  id        Int      @id
  email     String   @unique
  name      String
  createdAt DateTime
  posts     Post[]
}

model Post {
  id     Int    @id
  orgId  Int
  slug   String
  @@index([orgId, slug])
}`,
  "/p/prisma/schema.prisma",
);

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("unindexedQueryRule", () => {
  it("flags a filter on an unindexed column", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`), schema };
    const diags = unindexedQueryRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("unindexed-query");
    expect(diags[0].message).toContain('"name"');
    expect(diags[0].message).toContain("no index");
  });

  it("stays silent when the filter hits an indexed column (@unique, @id)", () => {
    for (const where of [`{ email: "a@b.c" }`, `{ id: 1 }`, `{ email: "a@b.c", name: "x" }`]) {
      const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: ${where} }); }`), schema };
      expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
    }
  });

  it("understands compound-index leading columns", () => {
    const flagged = { descriptors: descriptors(`async function f(p){ return p.post.findMany({ where: { slug: "s" } }); }`), schema };
    const diags = unindexedQueryRule.match(flagged);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("orgId"); // hints at the partial compound index
    const ok = { descriptors: descriptors(`async function f(p){ return p.post.findMany({ where: { orgId: 1 } }); }`), schema };
    expect(unindexedQueryRule.match(ok)).toHaveLength(0);
  });

  it("flags an unindexed sort on an unfiltered read", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ orderBy: { createdAt: "desc" } }); }`), schema };
    const diags = unindexedQueryRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"createdAt"');
    expect(diags[0].message).toContain("sort");
  });

  it("does not flag an unindexed sort when the filter is indexed", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { email: "a@b.c" }, orderBy: { createdAt: "desc" } }); }`), schema };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });

  it("emits at most one diagnostic per query (unindexed filter + unindexed sort)", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" }, orderBy: { createdAt: "desc" } }); }`), schema };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(1);
  });

  it("skips relation filters, logical composites, unknown models, and writes", () => {
    for (const code of [
      `async function f(p){ return p.user.findMany({ where: { posts: { some: { id: 1 } } } }); }`,
      `async function f(p){ return p.user.findMany({ where: { OR: [{ name: "a" }, { name: "b" }] } }); }`,
      `async function f(p){ return p.invoice.findMany({ where: { ref: "x" } }); }`,
      `async function f(p){ return p.user.updateMany({ where: { name: "x" }, data: {} }); }`,
    ]) {
      const ctx = { descriptors: descriptors(code), schema };
      expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
    }
  });

  it("is silenced by a knowledge file that marks the table small", () => {
    const knowledge = parseKnowledge(`version: 1\ntables:\n  user:\n    rows: 20\n`, "/p");
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`), schema, knowledge };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });

  it("does nothing without a schema", () => {
    const ctx = { descriptors: descriptors(`async function f(p){ return p.user.findMany({ where: { name: "x" } }); }`) };
    expect(unindexedQueryRule.match(ctx)).toHaveLength(0);
  });
});
