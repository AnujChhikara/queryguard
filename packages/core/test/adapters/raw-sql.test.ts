import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { parseSource, findQueryCandidates } from "../../src/parse.js";
import { rawSqlAdapter } from "../../src/adapters/raw-sql.js";

function taggedTemplate(code: string) {
  const sf = parseSource(code);
  return sf.getFirstDescendantByKind(SyntaxKind.TaggedTemplateExpression)!;
}
function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findQueryCandidates(sf).find(
    (n) => n.getKind() === SyntaxKind.CallExpression && n.getText().startsWith(calleeText),
  )!;
}

describe("rawSqlAdapter", () => {
  it("recognizes a SELECT tagged template without WHERE/LIMIT as an unfiltered read", () => {
    const t = taggedTemplate("async function r(sql){ await sql`SELECT * FROM users`; }");
    const d = rawSqlAdapter(t);
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("raw-sql");
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("users");
    expect(d!.confidence).toBe("high");
    expect(d!.hasFilter).toBe(false);
    expect(d!.hasLimit).toBe(false);
    expect(d!.isAggregate).toBe(false);
  });

  it("reads WHERE and LIMIT out of the SQL text", () => {
    const t = taggedTemplate("async function r(sql, id){ await sql`SELECT id FROM users WHERE id = ${id} LIMIT 10`; }");
    const d = rawSqlAdapter(t);
    expect(d!.hasFilter).toBe(true);
    expect(d!.hasLimit).toBe(true);
  });

  it("classifies a COUNT(*) select as an aggregate", () => {
    const t = taggedTemplate("async function r(sql){ await sql`SELECT COUNT(*) FROM users`; }");
    expect(rawSqlAdapter(t)!.isAggregate).toBe(true);
  });

  it("classifies INSERT / UPDATE / DELETE operations and their target", () => {
    const ins = taggedTemplate("async function r(sql){ await sql`INSERT INTO users (name) VALUES ('a')`; }");
    expect(rawSqlAdapter(ins)!.operation).toBe("write");
    expect(rawSqlAdapter(ins)!.target).toBe("users");
    const del = taggedTemplate("async function r(sql){ await sql`DELETE FROM sessions WHERE id = 1`; }");
    expect(rawSqlAdapter(del)!.operation).toBe("delete");
    expect(rawSqlAdapter(del)!.target).toBe("sessions");
  });

  it("recognizes a db.query('SELECT ...') string call", () => {
    const c = firstCall(`async function r(db){ await db.query("SELECT * FROM orders"); }`, "db.query");
    const d = rawSqlAdapter(c);
    expect(d).not.toBeNull();
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("orders");
  });

  it("marks a raw query inside a loop", () => {
    const t = taggedTemplate("async function r(sql, ids){ for (const id of ids){ await sql`SELECT * FROM posts WHERE authorId = ${id}`; } }");
    expect(rawSqlAdapter(t)!.inLoop).toBe(true);
  });

  it("returns null for a non-SQL tagged template", () => {
    const t = taggedTemplate("async function r(css){ const x = css`color: red`; }");
    expect(rawSqlAdapter(t)).toBeNull();
  });

  it("returns null for a non-query call", () => {
    const c = firstCall(`async function r(db){ await db.query({ not: "sql" }); }`, "db.query");
    expect(rawSqlAdapter(c)).toBeNull();
  });
});
