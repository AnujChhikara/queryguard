import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { overFetchRule } from "../../src/rules/over-fetch.js";
import type { QueryDescriptor } from "../../src/types.js";

const knowledge = parseKnowledge(
  `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
  tag:
    rows: 12
`,
  "/p",
);

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("overFetchRule", () => {
  it("flags an unfiltered read on a large table that has a small selective filter", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany(); }`), knowledge };
    const diags = overFetchRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("over-fetch");
    expect(diags[0].message).toContain("status");
  });

  it("does not flag when a where is present", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany({ where: { status: "active" } }); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag a small table (tag: 12) even unfiltered", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.tag.findMany(); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag without knowledge", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.findMany(); }`) };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });

  it("does not flag aggregates", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ return prisma.user.count(); }`), knowledge };
    expect(overFetchRule.match(ctx)).toHaveLength(0);
  });
});
