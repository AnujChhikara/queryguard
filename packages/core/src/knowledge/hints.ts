import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode } from "ts-morph";

export type InlineHint = { kind: "bounded" | "unbounded"; count?: number };

const ITERATION_METHODS = new Set(["map", "forEach", "flatMap"]);
const HINT_RE = /queryguard:\s*(bounded|unbounded)(?:\s+(\d+))?/;

/** The statement/expression whose leading comment carries the loop hint. */
function loopCarrier(queryNode: TsNode): TsNode | null {
  const loop = queryNode.getFirstAncestor(
    (a) =>
      Node.isForStatement(a) ||
      Node.isForOfStatement(a) ||
      Node.isForInStatement(a) ||
      Node.isWhileStatement(a) ||
      Node.isDoStatement(a),
  );
  if (loop) return loop;
  const iterCall = queryNode.getFirstAncestor((a) => {
    if (!Node.isCallExpression(a)) return false;
    const e = a.getExpression();
    return Node.isPropertyAccessExpression(e) && ITERATION_METHODS.has(e.getName());
  });
  // For a .map(...) call, the hint sits above the enclosing statement.
  return iterCall ? iterCall.getFirstAncestorByKind(SyntaxKind.ExpressionStatement) ?? iterCall : null;
}

export function readInlineHint(queryNode: TsNode): InlineHint | null {
  const carrier = loopCarrier(queryNode);
  if (!carrier) return null;
  for (const range of carrier.getLeadingCommentRanges()) {
    const m = HINT_RE.exec(range.getText());
    if (m) {
      const kind = m[1] as "bounded" | "unbounded";
      return kind === "bounded" && m[2] ? { kind, count: Number(m[2]) } : { kind };
    }
  }
  return null;
}
