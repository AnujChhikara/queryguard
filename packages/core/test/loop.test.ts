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

  it("is false for a bounded retry loop (for attempt <= maxRetries)", () => {
    const call = callNamed(
      `async function r(client, q){ for (let attempt = 1; attempt <= 3; attempt++){ client.query(q); } }`,
      "client.query",
    );
    expect(isInsideLoop(call)).toBe(false);
  });

  it("is false for a while-poll loop (condition has no .length/.size)", () => {
    const call = callNamed(
      `async function r(db){ let locked = false; while (!locked){ locked = db.tryLock(); } }`,
      "db.tryLock",
    );
    expect(isInsideLoop(call)).toBe(false);
  });

  it("is true for a C-style for iterating an array (condition uses .length)", () => {
    const call = callNamed(
      `async function r(db, items){ for (let i = 0; i < items.length; i++){ db.user.findUnique({ where: { id: items[i] } }); } }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });

  it("is true for a query nested in a retry loop inside a for-of (outer collection loop counts)", () => {
    const call = callNamed(
      `async function r(db, ids){ for (const id of ids){ for (let a = 0; a < 3; a++){ db.user.findUnique({ where: { id } }); } } }`,
      "db.user.findUnique",
    );
    expect(isInsideLoop(call)).toBe(true);
  });
});
