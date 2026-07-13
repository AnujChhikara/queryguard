import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor, QueryFilter } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set(["findMany", "findFirst"]);

function literalValue(node: TsNode): string | number | boolean | undefined {
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** The column name from a `table.column` reference or a bare identifier. */
function columnLeaf(node: TsNode | undefined): string | undefined {
  if (!node) return undefined;
  if (Node.isPropertyAccessExpression(node)) return node.getName();
  if (Node.isIdentifier(node)) return node.getText();
  return undefined;
}

/**
 * Walks Drizzle's operator-function `where` (eq/and/inArray/…). `matchable` turns
 * false under or()/not(), where predicates can't be superset-matched as eq.
 */
function walkDrizzle(node: TsNode | undefined, out: QueryFilter[], matchable: boolean): void {
  if (!node || !Node.isCallExpression(node)) return;
  const callee = node.getExpression();
  const name = Node.isIdentifier(callee)
    ? callee.getText()
    : Node.isPropertyAccessExpression(callee)
      ? callee.getName()
      : "";
  const args = node.getArguments();

  if (name === "and") {
    for (const a of args) walkDrizzle(a, out, matchable);
    return;
  }
  if (name === "or" || name === "not") {
    for (const a of args) walkDrizzle(a, out, false);
    return;
  }

  const field = columnLeaf(args[0]);
  if (!field) return;

  if (name === "eq" && matchable) {
    const value = literalValue(args[1]);
    out.push(value !== undefined ? { field, value, kind: "eq" } : { field, kind: "eq" });
  } else if (name === "inArray" && matchable) {
    out.push({ field, kind: "in" });
  } else {
    out.push({ field, kind: "other" }); // ne/gt/lt/like/eq-under-or/…
  }
}

function extractDrizzleFilters(whereInit: TsNode | undefined): QueryFilter[] {
  const out: QueryFilter[] = [];
  walkDrizzle(whereInit, out, true);
  return out;
}

/**
 * Drizzle's relational query API: `db.query.<table>.findMany|findFirst({...})`.
 * The chained query builder (`db.select().from(t)...`) and insert/update/delete
 * builders are intentionally out of scope for this pass.
 */
export function drizzleAdapter(node: TsNode): QueryDescriptor | null {
  if (!Node.isCallExpression(node)) return null;
  const call = node;

  // call.expression must be <...>.<method>
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();
  if (!READ_METHODS.has(method)) return null;

  // receiver must be <base>.query.<table>
  const tableAccess = expr.getExpression();
  if (!Node.isPropertyAccessExpression(tableAccess)) return null;
  const table = tableAccess.getName();

  const queryAccess = tableAccess.getExpression();
  if (!Node.isPropertyAccessExpression(queryAccess)) return null;
  if (queryAccess.getName() !== "query") return null;

  const [firstArg] = call.getArguments();
  const opts = firstArg && Node.isObjectLiteralExpression(firstArg) ? firstArg : undefined;
  const hasProp = (name: string) => Boolean(opts?.getProperty(name));

  const whereProp = opts?.getProperty("where");
  const whereInit =
    whereProp && Node.isPropertyAssignment(whereProp) ? whereProp.getInitializer() : undefined;

  return {
    db: "unknown",
    orm: "drizzle",
    operation: "read",
    target: table,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a))),
    confidence: "high",
    // findFirst returns at most one row — an implicit limit.
    hasLimit: hasProp("limit") || method === "findFirst",
    hasFilter: hasProp("where"),
    filters: extractDrizzleFilters(whereInit),
    isAggregate: false,
  };
}
