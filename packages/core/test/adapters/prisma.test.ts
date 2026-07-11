import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("prismaAdapter", () => {
  it("recognizes a findMany read call and fills the descriptor", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    const d = prismaAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("prisma");
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("user");
    expect(d!.awaited).toBe(true);
  });

  it("classifies create as a write", () => {
    const call = firstCall(`async function r(prisma){ await prisma.post.create({ data: {} }); }`, "prisma.post.create");
    expect(prismaAdapter(call)!.operation).toBe("write");
  });

  it("returns null for non-prisma calls", () => {
    const call = firstCall(`function r(){ console.log("x"); }`, "console.log");
    expect(prismaAdapter(call)).toBeNull();
  });

  it("returns null for a two-part call that is not model.method shaped", () => {
    const call = firstCall(`async function r(prisma){ await prisma.findMany(); }`, "prisma.findMany");
    expect(prismaAdapter(call)).toBeNull();
  });

  it("marks prisma descriptors as high confidence", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    expect(prismaAdapter(call)!.confidence).toBe("high");
  });

  it("detects presence of where (hasFilter) and take (hasLimit)", () => {
    const withBoth = firstCall(`async function r(prisma){ await prisma.user.findMany({ where: { id: 1 }, take: 10 }); }`, "prisma.user.findMany");
    const d1 = prismaAdapter(withBoth)!;
    expect(d1.hasFilter).toBe(true);
    expect(d1.hasLimit).toBe(true);

    const withNeither = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    const d2 = prismaAdapter(withNeither)!;
    expect(d2.hasFilter).toBe(false);
    expect(d2.hasLimit).toBe(false);
  });

  it("collects selected fields from a select object", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany({ select: { id: true, name: true } }); }`, "prisma.user.findMany");
    expect(prismaAdapter(call)!.selectedFields).toEqual(["id", "name"]);
  });

  it("extracts equality where-predicates into filters", () => {
    const call = firstCall(
      `async function r(prisma){ await prisma.user.findMany({ where: { status: "active", orgId: 3 } }); }`,
      "prisma.user.findMany",
    );
    const d = prismaAdapter(call)!;
    expect(d.filters).toEqual([
      { field: "status", value: "active", kind: "eq" },
      { field: "orgId", value: 3, kind: "eq" },
    ]);
  });

  it("classifies an { in: [...] } predicate as kind 'in' and nested objects as 'other'", () => {
    const call = firstCall(
      `async function r(prisma){ await prisma.user.findMany({ where: { id: { in: [1,2] }, profile: { age: 5 } } }); }`,
      "prisma.user.findMany",
    );
    const d = prismaAdapter(call)!;
    expect(d.filters).toEqual([
      { field: "id", kind: "in" },
      { field: "profile", kind: "other" },
    ]);
  });

  it("leaves filters empty when there is no where", () => {
    const call = firstCall(`async function r(prisma){ await prisma.user.findMany(); }`, "prisma.user.findMany");
    expect(prismaAdapter(call)!.filters).toEqual([]);
  });
});
