import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { parseSource } from "../../src/parse.js";
import { rawSqlAdapter } from "../../src/adapters/raw-sql.js";
import { orderByRandRule } from "../../src/rules/order-by-rand.js";
import type { QueryDescriptor } from "../../src/types.js";

function sqlDescriptor(code: string): QueryDescriptor {
  const sf = parseSource(code);
  const tagged = sf.getFirstDescendantByKind(SyntaxKind.TaggedTemplateExpression)!;
  return rawSqlAdapter(tagged)!;
}

describe("orderByRandRule", () => {
  it("flags ORDER BY RAND()", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT * FROM users ORDER BY RAND() LIMIT 1`; }")] };
    const diags = orderByRandRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("order-by-rand");
    expect(diags[0].severity).toBe("warning");
  });

  it("flags ORDER BY RANDOM() (Postgres spelling)", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT id FROM t ORDER BY RANDOM()`; }")] };
    expect(orderByRandRule.match(ctx)).toHaveLength(1);
  });

  it("does not flag a normal ORDER BY", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT * FROM users ORDER BY created_at DESC`; }")] };
    expect(orderByRandRule.match(ctx)).toHaveLength(0);
  });
});
