import { Node } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import { isInsideLoop } from "../loop.js";

const READ_METHODS = new Set([
  "find", "findOne", "findById", "countDocuments", "estimatedDocumentCount",
  "distinct", "aggregate", "exists",
]);
const WRITE_METHODS = new Set([
  "create", "insertMany", "updateOne", "updateMany", "save", "findOneAndUpdate", "replaceOne",
]);
const DELETE_METHODS = new Set(["deleteOne", "deleteMany", "remove", "findOneAndDelete"]);
const AGGREGATE_METHODS = new Set([
  "countDocuments", "estimatedDocumentCount", "aggregate", "distinct",
]);
const ALWAYS_FILTERED = new Set(["findById", "findByIdAndUpdate", "findByIdAndDelete"]);

const ALL_METHODS = new Set([...READ_METHODS, ...WRITE_METHODS, ...DELETE_METHODS]);

function operationFor(method: string): QueryDescriptor["operation"] {
  if (READ_METHODS.has(method)) return "read";
  if (WRITE_METHODS.has(method)) return "write";
  if (DELETE_METHODS.has(method)) return "delete";
  return "unknown";
}

/** The leaf name of the receiver, or null if it isn't an identifier / property access. */
function receiverLeaf(receiver: TsNode): string | null {
  if (Node.isIdentifier(receiver)) return receiver.getText();
  if (Node.isPropertyAccessExpression(receiver)) return receiver.getName();
  return null;
}

/** A Mongoose model receiver is a capitalized identifier or ends in "Model". */
function looksLikeModel(leaf: string): boolean {
  return /^[A-Z]/.test(leaf) || leaf.endsWith("Model");
}

/** Walk the fluent chain above the query call, looking for a `.limit(...)`. */
function hasChainedLimit(call: TsNode): boolean {
  let cur: TsNode | undefined = call.getParent();
  while (cur) {
    if (Node.isPropertyAccessExpression(cur)) {
      if (cur.getName() === "limit" && Node.isCallExpression(cur.getParent())) return true;
      cur = cur.getParent();
    } else if (Node.isCallExpression(cur) || Node.isAwaitExpression(cur)) {
      cur = cur.getParent();
    } else {
      break;
    }
  }
  return false;
}

export function mongooseAdapter(node: TsNode): QueryDescriptor | null {
  if (!Node.isCallExpression(node)) return null;
  const call = node;

  const expr = call.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;
  const method = expr.getName();
  if (!ALL_METHODS.has(method)) return null;

  const [firstArg] = call.getArguments();

  // Disambiguate Model.find({...}) from Array.prototype.find(cb).
  if (method === "find" && firstArg && (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg))) {
    return null;
  }

  const leaf = receiverLeaf(expr.getExpression());
  if (!leaf || !looksLikeModel(leaf)) return null;

  const hasFilter =
    ALWAYS_FILTERED.has(method) ||
    Boolean(firstArg && Node.isObjectLiteralExpression(firstArg) && firstArg.getProperties().length > 0);

  return {
    db: "mongodb",
    orm: "mongoose",
    operation: operationFor(method),
    target: leaf,
    node: call,
    inLoop: isInsideLoop(call),
    awaited: Boolean(call.getFirstAncestor((a) => Node.isAwaitExpression(a))),
    confidence: "high",
    hasLimit: hasChainedLimit(call),
    hasFilter,
    isAggregate: AGGREGATE_METHODS.has(method),
  };
}
