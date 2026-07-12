import { Node } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set(["findMany", "findFirst"]);

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

  return {
    db: "unknown",
    orm: "drizzle",
    operation: "read",
    target: table,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a))),
    confidence: "high",
    hasLimit: hasProp("limit"),
    hasFilter: hasProp("where"),
    isAggregate: false,
  };
}
