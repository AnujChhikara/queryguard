import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../src/parse.js";

describe("parse", () => {
  it("returns all call expressions in a source file", () => {
    const sf = parseSource(`
      async function run(db) {
        await db.user.findMany();
        console.log("hi");
      }
    `);
    const calls = findCallExpressions(sf).map((c) => c.getExpression().getText());
    expect(calls).toContain("db.user.findMany");
    expect(calls).toContain("console.log");
  });

  it("does not throw on syntactically incomplete code", () => {
    expect(() => parseSource("const x = ")).not.toThrow();
  });
});
