import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { heuristicAdapter } from "../../src/adapters/heuristic.js";
import { nPlusOneRule } from "../../src/rules/n-plus-one.js";
import type { QueryDescriptor } from "../../src/types.js";

function descriptors(code: string): QueryDescriptor[] {
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

describe("nPlusOneRule", () => {
  it("flags a prisma query inside a loop", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`) };
    const diags = nPlusOneRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message.toLowerCase()).toContain("loop");
  });

  it("does not flag a query outside a loop", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma){ await prisma.user.findMany(); }`) };
    expect(nPlusOneRule.match(ctx)).toHaveLength(0);
  });

  it("flags a heuristic (no-ORM) query in a loop as a WARNING", () => {
    const ctx = { descriptors: heuristicDescriptors(`async function r(items){ await Promise.all(items.map(async (i) => { await dataAccess.retrieveUsers({ id: i.id }); })); }`) };
    const diags = nPlusOneRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("warning");
  });

  it("keeps a prisma query in a loop as an ERROR", () => {
    const ctx = { descriptors: descriptors(`async function r(prisma, ids){ for (const id of ids){ await prisma.user.findUnique({ where: { id } }); } }`) };
    expect(nPlusOneRule.match(ctx)[0].severity).toBe("error");
  });
});
