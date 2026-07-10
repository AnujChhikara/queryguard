import type { Node } from "ts-morph";

export type Severity = "error" | "warning" | "info";

export interface SourceRange {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface Diagnostic {
  ruleId: string;
  severity: Severity;
  message: string;
  range: SourceRange;
  docsUrl?: string;
}

export interface QueryDescriptor {
  db: string;
  orm: string;
  operation: "read" | "write" | "delete" | "unknown";
  target: string;
  selectedFields?: string[];
  hasLimit?: boolean;
  hasFilter?: boolean;
  node: Node;
  inLoop: boolean;
  awaited: boolean;
  confidence: "high" | "heuristic";
}

export interface RuleContext {
  descriptors: QueryDescriptor[];
}

export interface Rule {
  id: string;
  defaultSeverity: Severity;
  match(ctx: RuleContext): Diagnostic[];
}

export function makeDiagnostic(input: {
  ruleId: string;
  severity: Severity;
  message: string;
  node: Node;
  docsUrl?: string;
}): Diagnostic {
  const { ruleId, severity, message, node, docsUrl } = input;
  const start = node.getStart();
  const lineAndCol = node.getSourceFile().getLineAndColumnAtPos(start);
  return {
    ruleId,
    severity,
    message,
    docsUrl,
    range: {
      start,
      end: node.getEnd(),
      line: lineAndCol.line,
      column: lineAndCol.column,
    },
  };
}
