import sqlParser from "node-sql-parser";

const { Parser } = sqlParser;
const parser = new Parser();

/**
 * Turns raw template/string SQL text into something a parser can accept:
 * strips surrounding quotes/backticks and replaces `${…}` interpolations with a
 * literal placeholder. Nested-brace interpolations may not fully normalize —
 * the caller treats a parse failure as "unknown".
 */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/^[`'"]/, "")
    .replace(/[`'"]$/, "")
    .replace(/\$\{[^}]*\}/g, "1");
}

/** Recursively counts JOIN clauses across a node-sql-parser AST (incl. subqueries). */
function countJoins(node: unknown): number {
  let n = 0;
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === "object") {
      if (typeof (v as { join?: unknown }).join === "string") n++;
      for (const value of Object.values(v as Record<string, unknown>)) visit(value);
    }
  };
  visit(node);
  return n;
}

/**
 * The number of JOIN clauses in a SQL string, or 0 when it contains no JOIN or
 * cannot be parsed. Uses a real SQL parser (accurate where regex would miscount
 * JOINs inside comments or string literals); falls back to 0 on any parse error.
 */
export function countSqlJoins(text: string): number {
  if (!/\bJOIN\b/i.test(text)) return 0;
  try {
    const ast = parser.astify(normalize(text));
    return countJoins(ast);
  } catch {
    return 0;
  }
}
