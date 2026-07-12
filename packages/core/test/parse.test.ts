import { describe, it, expect } from "vitest";
import { Node } from "ts-morph";
import { parseSource, findCallExpressions, findQueryCandidates } from "../src/parse.js";

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

describe("findQueryCandidates", () => {
  it("returns both call expressions and tagged template expressions", () => {
    const sf = parseSource(`
      async function run(db) {
        await db.user.findMany();
        await db.execute(sql\`SELECT * FROM users\`);
      }
    `);
    const nodes = findQueryCandidates(sf);
    const calls = nodes.filter(Node.isCallExpression).map((c) => c.getExpression().getText());
    const tagged = nodes.filter(Node.isTaggedTemplateExpression).map((t) => t.getTag().getText());
    expect(calls).toContain("db.user.findMany");
    expect(calls).toContain("db.execute");
    expect(tagged).toContain("sql");
  });
});
