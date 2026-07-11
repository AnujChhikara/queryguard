import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import { resolveDrivingSet } from "../../src/knowledge/driving-set.js";
import type { QueryDescriptor } from "../../src/types.js";

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

function build(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}
function loopOne(ds: QueryDescriptor[]): QueryDescriptor {
  return ds.find((d) => d.inLoop)!;
}

describe("resolveDrivingSet", () => {
  it("traces a small driving set (filtered producer in same function)", () => {
    const ds = build(`
      async function r(prisma){
        const active = await prisma.user.findMany({ where: { status: "active" } });
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge)).toEqual({ count: 10, bound: "small", source: "filter" });
  });

  it("traces a large driving set (unfiltered producer)", () => {
    const ds = build(`
      async function r(prisma){
        const all = await prisma.user.findMany();
        for (const u of all) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("large");
  });

  it("is unknown when the collection is reassigned", () => {
    const ds = build(`
      async function r(prisma, other){
        let active = await prisma.user.findMany({ where: { status: "active" } });
        active = other;
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });

  it("is unknown when the collection is not a plain identifier", () => {
    const ds = build(`
      async function r(prisma){
        for (const u of (await prisma.user.findMany({ where: { status: "active" } }))) {
          await prisma.post.findMany({ where: { authorId: u.id } });
        }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });

  it("is unknown when the producer is not a known query", () => {
    const ds = build(`
      async function r(prisma, fetchUsers){
        const active = await fetchUsers();
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }
    `);
    expect(resolveDrivingSet(loopOne(ds), ds, knowledge).bound).toBe("unknown");
  });
});
