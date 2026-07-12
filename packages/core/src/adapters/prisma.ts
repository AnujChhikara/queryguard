import { Node, SyntaxKind } from "ts-morph";
import type { CallExpression, Node as TsNode } from "ts-morph";
import type { QueryDescriptor, QueryFilter } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set(["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const DELETE_METHODS = new Set(["delete", "deleteMany"]);
const AGGREGATE_METHODS = new Set(["count", "aggregate", "groupBy"]);

function operationFor(method: string): QueryDescriptor["operation"] {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  if (DELETE_METHODS.has(method)) return "delete";
  return "unknown";
}

const ALL_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...DELETE_METHODS]);

function extractFilters(whereInit: unknown): QueryFilter[] {
  const node = whereInit;
  if (!node || !Node.isObjectLiteralExpression(node as Node)) return [];
  return (node as import("ts-morph").ObjectLiteralExpression)
    .getProperties()
    .filter(Node.isPropertyAssignment)
    .map((p): QueryFilter => {
      const field = p.getName();
      const init = p.getInitializer();
      if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
        return { field, value: init.getLiteralValue(), kind: "eq" };
      }
      if (init && Node.isNumericLiteral(init)) {
        return { field, value: init.getLiteralValue(), kind: "eq" };
      }
      if (init && (init.getKind() === SyntaxKind.TrueKeyword || init.getKind() === SyntaxKind.FalseKeyword)) {
        return { field, value: init.getText() === "true", kind: "eq" };
      }
      if (init && Node.isObjectLiteralExpression(init) && init.getProperty("in")) {
        return { field, kind: "in" };
      }
      return { field, kind: "other" };
    });
}

function readOptions(call: CallExpression): {
  hasLimit: boolean;
  hasFilter: boolean;
  selectedFields: string[];
  filters: QueryFilter[];
} {
  const [firstArg] = call.getArguments();
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return { hasLimit: false, hasFilter: false, selectedFields: [], filters: [] };
  }
  const hasProp = (name: string) => Boolean(firstArg.getProperty(name));
  const selectProp = firstArg.getProperty("select");
  let selectedFields: string[] = [];
  if (selectProp && Node.isPropertyAssignment(selectProp)) {
    const init = selectProp.getInitializer();
    if (init && Node.isObjectLiteralExpression(init)) {
      selectedFields = init
        .getProperties()
        .filter(Node.isPropertyAssignment)
        .map((p) => p.getName());
    }
  }
  const whereProp = firstArg.getProperty("where");
  const whereInit =
    whereProp && Node.isPropertyAssignment(whereProp) ? whereProp.getInitializer() : undefined;
  return {
    hasLimit: hasProp("take"),
    hasFilter: hasProp("where"),
    selectedFields,
    filters: extractFilters(whereInit),
  };
}

export function prismaAdapter(node: TsNode): QueryDescriptor | null {
  if (!Node.isCallExpression(node)) return null;
  const call = node;
  const expr = call.getExpression();
  // Expect: <base>.<model>.<method>
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();
  if (!ALL_METHODS.has(method)) return null;

  const modelAccess = expr.getExpression();
  if (!Node.isPropertyAccessExpression(modelAccess)) return null;
  const model = modelAccess.getName();

  const base = modelAccess.getExpression();
  if (!Node.isIdentifier(base) && !Node.isPropertyAccessExpression(base)) return null;

  const isAwaited = Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a)));

  const options = readOptions(call);

  return {
    db: "postgres",
    orm: "prisma",
    operation: operationFor(method),
    target: model,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: isAwaited,
    confidence: "high",
    hasLimit: options.hasLimit,
    hasFilter: options.hasFilter,
    selectedFields: options.selectedFields,
    filters: options.filters,
    isAggregate: AGGREGATE_METHODS.has(method),
  };
}
