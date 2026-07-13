import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode, FunctionDeclaration } from "ts-morph";
import type { QueryDescriptor } from "../types.js";
import type { Cardinality, Knowledge } from "./types.js";
import { estimateCardinality } from "./cardinality.js";

const UNKNOWN: Cardinality = { bound: "unknown", source: "none" };
const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);
const FUNCTION_KINDS = (a: TsNode) =>
  Node.isFunctionDeclaration(a) ||
  Node.isFunctionExpression(a) ||
  Node.isArrowFunction(a) ||
  Node.isMethodDeclaration(a);

/** The identifier naming the collection this loop iterates, or null. */
function iteratedIdentifier(queryNode: TsNode): TsNode | null {
  const forOf = queryNode.getFirstAncestorByKind(SyntaxKind.ForOfStatement);
  if (forOf) {
    const expr = forOf.getExpression();
    return Node.isIdentifier(expr) ? expr : null;
  }
  const iterCall = queryNode.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const e = a.getExpression();
    return Node.isPropertyAccessExpression(e) && ITERATION_METHODS.has(e.getName());
  });
  if (iterCall && Node.isCallExpression(iterCall)) {
    const e = iterCall.getExpression();
    if (Node.isPropertyAccessExpression(e)) {
      const receiver = e.getExpression();
      return Node.isIdentifier(receiver) ? receiver : null;
    }
  }
  return null;
}

function isReassigned(fn: TsNode, name: string): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
    if (id.getText() !== name) return false;
    const p = id.getParent();
    if (Node.isBinaryExpression(p) && p.getOperatorToken().getText() === "=" && p.getLeft() === id) return true;
    if (Node.isPostfixUnaryExpression(p) || Node.isPrefixUnaryExpression(p)) return true;
    return false;
  });
}

export function resolveDrivingSet(
  loopDescriptor: QueryDescriptor,
  descriptors: QueryDescriptor[],
  k: Knowledge | null | undefined,
): Cardinality {
  if (!k) return UNKNOWN;
  const ident = iteratedIdentifier(loopDescriptor.node);
  if (!ident) return UNKNOWN;
  const name = ident.getText();

  const fn = loopDescriptor.node.getFirstAncestor(FUNCTION_KINDS) as FunctionDeclaration | undefined;
  if (!fn) return UNKNOWN;
  if (isReassigned(fn, name)) return UNKNOWN;

  const decls = fn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((d) => d.getName() === name);
  if (decls.length !== 1) return UNKNOWN;

  let init = decls[0].getInitializer();
  if (init && Node.isAwaitExpression(init)) init = init.getExpression();
  // A known query call or a raw-SQL tagged template (`sql`…``).
  if (!init || !(Node.isCallExpression(init) || Node.isTaggedTemplateExpression(init))) return UNKNOWN;

  const producer = descriptors.find((d) => d.node.getStart() === init!.getStart());
  if (!producer) return UNKNOWN;

  return estimateCardinality(producer, k);
}
