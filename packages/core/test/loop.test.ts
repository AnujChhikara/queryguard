import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../src/parse.js";
import { isInsideLoop } from "../src/loop.js";

function callNamed(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("isInsideLoop", () => {
  it("is true for a call inside a for-of loop", () => {
    const call = callNamed(
      `async function r(db, ids){ for (const id of ids){ await db.user.findUnique({ where: { id } }); } }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });

  it("is true for a call inside an array .map callback", () => {
    const call = callNamed(
      `async function r(db, ids){ await Promise.all(ids.map((id) => db.user.findUnique({ where: { id } }))); }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });

  it("is false for a top-level call", () => {
    const call = callNamed(
      `async function r(db){ await db.user.findMany(); }`,
      "db.user.findMany",
    );
    expect(isInsideLoop(call)).toBe(false);
  });
});
