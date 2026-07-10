import { Node } from "ts-morph";
import type { CallExpression } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set(["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "findFirstOrThrow", "count", "aggregate", "groupBy"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);
const DELETE_METHODS = new Set(["delete", "deleteMany"]);

function operationFor(method: string): QueryDescriptor["operation"] {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  if (DELETE_METHODS.has(method)) return "delete";
  return "unknown";
}

const ALL_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...DELETE_METHODS]);

function readOptions(call: CallExpression): {
  hasLimit: boolean;
  hasFilter: boolean;
  selectedFields: string[];
} {
  const [firstArg] = call.getArguments();
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return { hasLimit: false, hasFilter: false, selectedFields: [] };
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
  return { hasLimit: hasProp("take"), hasFilter: hasProp("where"), selectedFields };
}

export function prismaAdapter(call: CallExpression): QueryDescriptor | null {
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
  };
}
