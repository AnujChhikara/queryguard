import sqlParser from "node-sql-parser";
import type { QueryFilter } from "../types.js";

const { Parser } = sqlParser;
const parser = new Parser();

/**
 * Sentinel substituted for `${…}` interpolations. Distinctive enough that a real
 * query is essentially never comparing against it, so a value equal to it is
 * treated as an unknown (interpolated) value rather than a matchable literal.
 */
const PARAM = 918273645;

/**
 * Turns raw template/string SQL text into something a parser can accept:
 * strips surrounding quotes/backticks and replaces `${…}` interpolations with a
 * numeric sentinel (parses in value and LIMIT positions). Nested-brace
 * interpolations may not fully normalize — the caller treats a parse failure as
 * "unknown".
 */
function normalize(text: string): string {
  return text
    .trim()
    .replace(/^[`'"]/, "")
    .replace(/[`'"]$/, "")
    .replace(/\$\{[^}]*\}/g, String(PARAM));
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

type SqlNode = Record<string, unknown>;

/** The literal value of a node-sql-parser value node, or undefined if not a literal. */
function literalValue(node: unknown): string | number | boolean | undefined {
  if (!node || typeof node !== "object") return undefined;
  const n = node as SqlNode;
  if (n.type === "single_quote_string" || n.type === "double_quote_string" || n.type === "number") {
    return n.value as string | number;
  }
  if (n.type === "bool") return Boolean(n.value);
  return undefined;
}

function isSentinel(v: unknown): boolean {
  return v === PARAM || v === String(PARAM);
}

function columnOf(node: unknown): string | undefined {
  if (node && typeof node === "object" && (node as SqlNode).type === "column_ref") {
    return (node as SqlNode).column as string;
  }
  return undefined;
}

/** Walk a WHERE AST, collecting AND-connected predicates as QueryFilters. */
function walkWhere(node: unknown, out: QueryFilter[]): void {
  if (!node || typeof node !== "object") return;
  const n = node as SqlNode;
  if (n.type !== "binary_expr") return;
  const op = n.operator;

  if (op === "AND") {
    walkWhere(n.left, out);
    walkWhere(n.right, out);
    return;
  }

  const field = columnOf(n.left);
  if (!field) return;

  if (op === "=") {
    const value = literalValue(n.right);
    if (value !== undefined && !isSentinel(value)) out.push({ field, value, kind: "eq" });
    else out.push({ field, kind: "eq" }); // interpolated / non-literal → unknown value
    return;
  }
  if (op === "IN") {
    out.push({ field, kind: "in" });
    return;
  }
  out.push({ field, kind: "other" }); // OR / comparisons / LIKE / functions
}

/**
 * Equality/IN predicates from a SQL WHERE clause, for knowledge-based cardinality
 * matching. Interpolated values are emitted as an eq with no value (unknown).
 * Returns [] when there is no WHERE or the SQL can't be parsed.
 */
export function extractSqlFilters(text: string): QueryFilter[] {
  if (!/\bWHERE\b/i.test(text)) return [];
  try {
    const ast = parser.astify(normalize(text));
    const stmt = Array.isArray(ast) ? ast[0] : ast;
    const out: QueryFilter[] = [];
    walkWhere((stmt as SqlNode | undefined)?.where, out);
    return out;
  } catch {
    return [];
  }
}
