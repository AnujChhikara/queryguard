import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { heuristicAdapter } from "../../src/adapters/heuristic.js";
import { unboundedReadRule } from "../../src/rules/unbounded-read.js";
import type { QueryDescriptor } from "../../src/types.js";

function prismaDescriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}
function heuristicDescriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => heuristicAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}

describe("unboundedReadRule", () => {
  it("warns on a read with neither where nor take", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.findMany(); }`) };
    const diags = unboundedReadRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("unbounded-read");
    expect(diags[0].severity).toBe("warning");
  });

  it("does NOT warn when a where is present (canonical batched read)", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma, ids){ await prisma.user.findMany({ where: { id: { in: ids } } }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn when a take is present", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.findMany({ take: 20 }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn on a heuristic (no-ORM) call with unknown shape", () => {
    const ctx = { descriptors: heuristicDescriptors(`async function r(){ await dataAccess.retrieveUsers({ id: 1 }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });

  it("does NOT warn on a write", () => {
    const ctx = { descriptors: prismaDescriptors(`async function r(prisma){ await prisma.user.create({ data: {} }); }`) };
    expect(unboundedReadRule.match(ctx)).toHaveLength(0);
  });
});
