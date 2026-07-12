import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { parseSource } from "../../src/parse.js";
import { rawSqlAdapter } from "../../src/adapters/raw-sql.js";
import { leadingWildcardLikeRule } from "../../src/rules/leading-wildcard-like.js";
import type { QueryDescriptor } from "../../src/types.js";

function sqlDescriptor(code: string): QueryDescriptor {
  const sf = parseSource(code);
  const tagged = sf.getFirstDescendantByKind(SyntaxKind.TaggedTemplateExpression)!;
  return rawSqlAdapter(tagged)!;
}

describe("leadingWildcardLikeRule", () => {
  it("flags LIKE '%...'", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT * FROM users WHERE email LIKE '%@gmail.com'`; }")] };
    const diags = leadingWildcardLikeRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("leading-wildcard-like");
    expect(diags[0].severity).toBe("warning");
  });

  it("flags ILIKE '%...' (Postgres)", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT id FROM t WHERE name ILIKE '%foo%'`; }")] };
    expect(leadingWildcardLikeRule.match(ctx)).toHaveLength(1);
  });

  it("does not flag a trailing-only wildcard (sargable)", () => {
    const ctx = { descriptors: [sqlDescriptor("async function r(sql){ await sql`SELECT * FROM users WHERE email LIKE 'a%'`; }")] };
    expect(leadingWildcardLikeRule.match(ctx)).toHaveLength(0);
  });
});
