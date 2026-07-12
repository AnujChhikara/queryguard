import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { readInlineHint } from "../../src/knowledge/hints.js";

function queryNode(code: string, callee: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === callee)!;
}

describe("readInlineHint", () => {
  it("reads 'bounded' with an optional count above a for-of loop", () => {
    const n = queryNode(
      `async function r(prisma, xs){
        // cardinal: bounded 10
        for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); }
      }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toEqual({ kind: "bounded", count: 10 });
  });

  it("reads 'unbounded' above a .map iteration", () => {
    const n = queryNode(
      `async function r(prisma, xs){
        // cardinal: unbounded
        await Promise.all(xs.map(async (x) => prisma.post.findMany({ where: { authorId: x.id } })));
      }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toEqual({ kind: "unbounded" });
  });

  it("returns null with no hint", () => {
    const n = queryNode(
      `async function r(prisma, xs){ for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); } }`,
      "prisma.post.findMany",
    );
    expect(readInlineHint(n)).toBeNull();
  });
});
