import { basename } from "node:path";
import { Node, SyntaxKind } from "ts-morph";
import type { Node as TsNode } from "ts-morph";
import type { QueryDescriptor, Diagnostic } from "../types.js";
import type { Knowledge } from "./types.js";

export function computeAnchor(node: TsNode): { fn: string; anchor: string } {
  const anchor = node.getText().replace(/\s+/g, " ").trim();
  const fnNode = node.getFirstAncestor(
    (a) =>
      Node.isFunctionDeclaration(a) ||
      Node.isFunctionExpression(a) ||
      Node.isArrowFunction(a) ||
      Node.isMethodDeclaration(a),
  );
  let fn = "<module>";
  if (fnNode) {
    if ((Node.isFunctionDeclaration(fnNode) || Node.isMethodDeclaration(fnNode)) && fnNode.getName()) {
      fn = fnNode.getName()!;
    } else {
      const varDecl = fnNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      fn = varDecl?.getName() ?? "<anonymous>";
    }
  }
  return { fn, anchor };
}

export function filterSuppressed(
  diags: Diagnostic[],
  descriptors: QueryDescriptor[],
  filePath: string | undefined,
  k: Knowledge | null | undefined,
): Diagnostic[] {
  if (!k || k.suppressions.length === 0) return diags;
  const base = filePath ? basename(filePath) : undefined;
  return diags.filter((diag) => {
    const producer = descriptors.find((d) => d.node.getStart() === diag.range.start);
    if (!producer) return true;
    const { fn, anchor } = computeAnchor(producer.node);
    const suppressed = k.suppressions.some(
      (s) =>
        s.rule === diag.ruleId &&
        s.fn === fn &&
        s.anchor === anchor &&
        (base === undefined || basename(s.file) === base),
    );
    return !suppressed;
  });
}
