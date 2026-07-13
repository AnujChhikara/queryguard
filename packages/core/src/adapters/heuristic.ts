import { Node } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

// Strong verbs are specific enough to a data read that they match on any
// receiver (e.g. `User.find(...)`, `repo.query(...)`). Kept deliberately to the
// ORM-shaped names that rarely collide with non-DB APIs.
const STRONG_VERBS = new Set([
  "find", "findone", "findbyid", "findmany", "findfirst", "findunique",
  "query", "aggregate",
]);

// Weak verbs are ambiguous with everyday JS and non-DB APIs (`cache.get`,
// `logger.getLevel`, Playwright `locator.count()`, Google API `client.list()`,
// `emails.search()`), so they only count as a query when the *receiver* also
// looks like a data source. This keeps the fallback adapter from crying wolf.
const WEAK_VERBS = new Set([
  "get", "fetch", "retrieve", "load", "lookup", "exists",
  "count", "list", "search", "select",
]);

// Only unambiguous data-source identifiers. Deliberately excludes generic names
// (store, em, model, collection) that are as likely to be Redux/entities/arrays.
const DATA_SOURCE_NAMES = new Set([
  "db", "database", "repo", "repository", "dao", "dataaccess", "knex",
  "prisma", "mongoose", "sequelize", "entitymanager",
]);

const BLOCKLIST = new Set([
  "map", "foreach", "filter", "reduce", "some", "every", "flatmap",
  "slice", "concat", "join", "keys", "values", "entries", "has", "add",
  "then", "catch", "finally", "json", "send", "status", "end",
]);

function verbStrength(method: string): "strong" | "weak" | "none" {
  const m = method.toLowerCase();
  if (STRONG_VERBS.has(m) || m.startsWith("findby") || m.startsWith("findall")) return "strong";
  if (
    WEAK_VERBS.has(m) ||
    m.startsWith("get") || m.startsWith("fetch") ||
    m.startsWith("retrieve") || m.startsWith("load") || m.startsWith("lookup")
  ) {
    return "weak";
  }
  return "none";
}

export function heuristicAdapter(node: TsNode): QueryDescriptor | null {
  if (!Node.isCallExpression(node)) return null;
  const call = node;
  // 1. must be directly awaited
  if (!Node.isAwaitExpression(call.getParent())) return null;

  // 2. callee must be a property access <receiver>.<method>
  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();

  // 4. never match blocklisted methods
  if (BLOCKLIST.has(method.toLowerCase())) return null;

  // 3. a strong verb matches alone; a weak verb needs a data-source receiver;
  //    a non-verb (dispatch, flush, save, ...) never matches.
  const strength = verbStrength(method);
  if (strength === "none") return null;
  if (strength === "weak") {
    const receiverText = expr.getExpression().getText();
    const receiverLeaf = receiverText.split(".").pop() ?? receiverText;
    if (!DATA_SOURCE_NAMES.has(receiverLeaf.toLowerCase())) return null;
  }

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
