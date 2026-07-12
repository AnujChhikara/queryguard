import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { parseSource } from "../../src/parse.js";
import { rawSqlAdapter } from "../../src/adapters/raw-sql.js";
import { excessiveJoinsRule } from "../../src/rules/excessive-joins.js";
import type { QueryDescriptor } from "../../src/types.js";

function sqlDescriptor(sql: string): QueryDescriptor {
  const sf = parseSource("async function r(sql){ await sql`" + sql + "`; }");
  const tagged = sf.getFirstDescendantByKind(SyntaxKind.TaggedTemplateExpression)!;
  return rawSqlAdapter(tagged)!;
}

const FIVE_JOINS =
  "SELECT * FROM a JOIN b ON a.id=b.a_id JOIN c ON b.id=c.b_id JOIN d ON c.id=d.c_id JOIN e ON d.id=e.d_id JOIN f ON e.id=f.e_id";
const TWO_JOINS = "SELECT * FROM a JOIN b ON a.id=b.a_id JOIN c ON b.id=c.b_id";

describe("excessiveJoinsRule", () => {
  it("flags a query with many joins", () => {
    const ctx = { descriptors: [sqlDescriptor(FIVE_JOINS)] };
    const diags = excessiveJoinsRule.match(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("excessive-joins");
    expect(diags[0].severity).toBe("warning");
  });

  it("does not flag a modest number of joins", () => {
    const ctx = { descriptors: [sqlDescriptor(TWO_JOINS)] };
    expect(excessiveJoinsRule.match(ctx)).toHaveLength(0);
  });
});
