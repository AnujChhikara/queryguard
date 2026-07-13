import { Node } from "ts-morph";

const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);
// An array/collection index loop compares a counter against a collection size.
const COLLECTION_SIZE = /\.(length|size)\b/;

/**
 * N+1 comes from iterating a *collection*. for-of / for-in and array-method
 * callbacks always iterate one. A C-style `for` or a `while`/`do-while` only
 * counts when its condition references `.length`/`.size` — otherwise it's a
 * bounded counter (retry loop) or a control-flow poll (`while (!locked)`),
 * which run the same query, not one-per-row.
 */
function isCollectionLoop(a: Node): boolean {
  if (Node.isForOfStatement(a) || Node.isForInStatement(a)) return true;
  if (Node.isForStatement(a)) {
    const cond = a.getCondition();
    return Boolean(cond && COLLECTION_SIZE.test(cond.getText()));
  }
  if (Node.isWhileStatement(a) || Node.isDoStatement(a)) {
    return COLLECTION_SIZE.test(a.getExpression().getText());
  }
  return false;
}

export function isInsideLoop(node: Node): boolean {
  // Any enclosing collection loop (an outer for-of still counts even if the
  // nearest loop is a retry counter).
  if (node.getFirstAncestor(isCollectionLoop)) return true;

  // Inside the callback of arr.map(...) / arr.forEach(...) / arr.flatMap(...)
  const iterationCallAncestor = node.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const expr = a.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    return ITERATION_METHODS.has(expr.getName());
  });
  return Boolean(iterationCallAncestor);
}
