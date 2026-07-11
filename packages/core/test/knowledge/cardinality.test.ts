import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { estimateCardinality, bucket } from "../../src/knowledge/cardinality.js";
import type { QueryDescriptor } from "../../src/types.js";

function descriptor(code: string, callee: string): QueryDescriptor {
  const sf = parseSource(code);
  const call = findCallExpressions(sf).find((c) => c.getExpression().getText() === callee)!;
  return prismaAdapter(call)!;
}

const knowledge = parseKnowledge(
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

describe("bucket", () => {
  it("buckets by thresholds inclusively at the edges", () => {
    const t = { small: 50, large: 1000 };
    expect(bucket(50, t)).toBe("small");
    expect(bucket(51, t)).toBe("medium");
    expect(bucket(999, t)).toBe("medium");
    expect(bucket(1000, t)).toBe("large");
  });
});

describe("estimateCardinality", () => {
  it("uses a matching filter fact (superset match) for a small bound", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany({ where: { status: "active", orgId: 1 } }); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge)).toEqual({ count: 10, bound: "small", source: "filter" });
  });

  it("falls back to table rows for an unfiltered read (large)", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge)).toEqual({ count: 10000, bound: "large", source: "table" });
  });

  it("returns unknown when filtered but no fact matches", () => {
    const d = descriptor(`async function r(prisma){ await prisma.user.findMany({ where: { orgId: 1 } }); }`, "prisma.user.findMany");
    expect(estimateCardinality(d, knowledge).bound).toBe("unknown");
  });

  it("returns unknown with no knowledge or unknown table", () => {
    const d = descriptor(`async function r(prisma){ await prisma.post.findMany(); }`, "prisma.post.findMany");
    expect(estimateCardinality(d, null).bound).toBe("unknown");
    expect(estimateCardinality(d, knowledge).bound).toBe("unknown");
  });
});
