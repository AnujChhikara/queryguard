import { Node } from "ts-morph";

const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);

export function isInsideLoop(node: Node): boolean {
  const loopAncestor = node.getFirstAncestor(
    (a) =>
      Node.isForStatement(a) ||
      Node.isForOfStatement(a) ||
      Node.isForInStatement(a) ||
      Node.isWhileStatement(a) ||
      Node.isDoStatement(a),
  );
  if (loopAncestor) return true;

  // Inside the callback of arr.map(...) / arr.forEach(...) / arr.flatMap(...)
  const iterationCallAncestor = node.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const expr = a.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return false;
    return ITERATION_METHODS.has(expr.getName());
  });
  return Boolean(iterationCallAncestor);
}
