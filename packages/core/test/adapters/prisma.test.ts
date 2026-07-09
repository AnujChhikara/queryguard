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
});
