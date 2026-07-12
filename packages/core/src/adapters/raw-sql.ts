import { Node } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";
import { countSqlJoins } from "../sql/parse.js";

const SQL_CALL_METHODS = new Set(["query", "execute", "raw"]);
const LEADING_KEYWORD = /^[\s`'"(]*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i;
const AGGREGATE_FN = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i;
const ORDER_BY_RAND = /\bORDER\s+BY\s+(RAND|RANDOM)\s*\(\s*\)/i;
const LEADING_WILDCARD_LIKE = /\bI?LIKE\s+'%/i;

interface SqlFacts {
  operation: QueryDescriptor["operation"];
  target: string;
  hasFilter: boolean;
  hasLimit: boolean;
  isAggregate: boolean;
  sqlFlags: { orderByRand: boolean; leadingWildcardLike: boolean; joinCount: number };
}

/** Thin, regex-level read of a SQL string. Returns null if it isn't SQL. */
function analyzeSql(text: string): SqlFacts | null {
  const m = LEADING_KEYWORD.exec(text);
  if (!m) return null;
  const keyword = m[1].toUpperCase();

  let operation: QueryDescriptor["operation"];
  let targetRe: RegExp;
  if (keyword === "SELECT" || keyword === "WITH") {
    operation = "read";
    targetRe = /\bFROM\s+["'`]?(\w+)/i;
  } else if (keyword === "INSERT") {
    operation = "write";
    targetRe = /\bINTO\s+["'`]?(\w+)/i;
  } else if (keyword === "UPDATE") {
    operation = "write";
    targetRe = /\bUPDATE\s+["'`]?(\w+)/i;
  } else {
    operation = "delete";
    targetRe = /\bFROM\s+["'`]?(\w+)/i;
  }

  return {
    operation,
    target: targetRe.exec(text)?.[1] ?? "unknown",
    hasFilter: /\bWHERE\b/i.test(text),
    hasLimit: /\bLIMIT\b/i.test(text),
    isAggregate: operation === "read" && AGGREGATE_FN.test(text),
    sqlFlags: {
      orderByRand: ORDER_BY_RAND.test(text),
      leadingWildcardLike: LEADING_WILDCARD_LIKE.test(text),
      joinCount: countSqlJoins(text),
    },
  };
}

/** The callee method name of a call expression, or null. */
function calleeMethod(call: TsNode): string | null {
  if (!Node.isCallExpression(call)) return null;
  const expr = call.getExpression();
  return Node.isPropertyAccessExpression(expr) ? expr.getName() : null;
}

function descriptor(node: TsNode, facts: SqlFacts): QueryDescriptor {
  return {
    db: "sql",
    orm: "raw-sql",
    operation: facts.operation,
    target: facts.target,
    node,
    inLoop: isInsideLoop(node),
    awaited: Boolean(node.getFirstAncestor((a) => Node.isAwaitExpression(a))),
    confidence: "high",
    hasLimit: facts.hasLimit,
    hasFilter: facts.hasFilter,
    isAggregate: facts.isAggregate,
    sqlFlags: facts.sqlFlags,
  };
}

export function rawSqlAdapter(node: TsNode): QueryDescriptor | null {
  // Form 1: sql`...` tagged template.
  if (Node.isTaggedTemplateExpression(node)) {
    if (node.getTag().getText() !== "sql") return null;
    // If this template is the argument of a query call (db.execute(sql`...`)),
    // let the call form represent it — avoids a double descriptor.
    const parent = node.getParent();
    if (
      parent &&
      Node.isCallExpression(parent) &&
      SQL_CALL_METHODS.has(calleeMethod(parent) ?? "") &&
      parent.getArguments().includes(node)
    ) {
      return null;
    }
    const facts = analyzeSql(node.getTemplate().getText());
    return facts ? descriptor(node, facts) : null;
  }

  // Form 2: receiver.query|execute|raw(<sql string or template>).
  if (Node.isCallExpression(node)) {
    const method = calleeMethod(node);
    if (!method || !SQL_CALL_METHODS.has(method)) return null;
    const [firstArg] = node.getArguments();
    if (!firstArg) return null;
    const isSqlSource =
      Node.isStringLiteral(firstArg) ||
      Node.isNoSubstitutionTemplateLiteral(firstArg) ||
      Node.isTemplateExpression(firstArg) ||
      Node.isTaggedTemplateExpression(firstArg);
    if (!isSqlSource) return null;
    const sqlText = Node.isTaggedTemplateExpression(firstArg)
      ? firstArg.getTemplate().getText()
      : firstArg.getText();
    const facts = analyzeSql(sqlText);
    return facts ? descriptor(node, facts) : null;
  }

  return null;
}
