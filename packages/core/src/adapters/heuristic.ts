import { Node } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const QUERY_VERBS = new Set([
  "find", "findone", "findbyid", "findmany", "get", "getby", "retrieve",
  "fetch", "query", "select", "aggregate", "count", "list", "search",
  "load", "lookup", "exists",
]);

const DATA_SOURCE_NAMES = new Set([
  "db", "database", "repo", "repository", "model", "models", "dao",
  "dataaccess", "store", "collection", "knex", "prisma", "mongoose",
  "sequelize", "em", "entitymanager",
]);

const BLOCKLIST = new Set([
  "map", "foreach", "filter", "reduce", "some", "every", "flatmap",
  "slice", "concat", "join", "keys", "values", "entries", "has", "add",
  "then", "catch", "finally", "json", "send", "status", "end",
]);

function looksLikeQueryVerb(method: string): boolean {
  const m = method.toLowerCase();
  if (QUERY_VERBS.has(m)) return true;
  // prefix forms like getById, getAllUserStatus, findByEmail
  return m.startsWith("get") || m.startsWith("find") || m.startsWith("retrieve") || m.startsWith("fetch");
}

export function heuristicAdapter(call: CallExpression): QueryDescriptor | null {
  // 1. must be directly awaited
  if (!Node.isAwaitExpression(call.getParent())) return null;

  // 2. callee must be a property access <receiver>.<method>
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();

  // 4. never match blocklisted methods
  if (BLOCKLIST.has(method.toLowerCase())) return null;

  // 3. method is a query verb OR receiver is a data-source name
  const receiverText = expr.getExpression().getText();
  const receiverLeaf = receiverText.split(".").pop() ?? receiverText;
  const receiverMatches = DATA_SOURCE_NAMES.has(receiverLeaf.toLowerCase());
  if (!looksLikeQueryVerb(method) && !receiverMatches) return null;

  return {
    db: "unknown",
    orm: "heuristic",
    operation: "unknown",
    target: method,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: true,
    confidence: "heuristic",
    selectedFields: undefined,
    hasLimit: undefined,
    hasFilter: undefined,
    isAggregate: undefined,
  };
}
