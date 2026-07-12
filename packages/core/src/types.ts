import type { Node } from "ts-morph";
import type { Cardinality, Knowledge } from "./knowledge/types.js";

export type { Cardinality, Bound, Knowledge } from "./knowledge/types.js";

export type Severity = "error" | "warning" | "info";

export interface QueryFilter {
  field: string;
  value?: string | number | boolean;
  kind: "eq" | "in" | "other";
}

export interface SqlFlags {
  /** ORDER BY RAND()/RANDOM() — full sort, no index. */
  orderByRand: boolean;
  /** LIKE/ILIKE with a leading '%' wildcard — non-sargable. */
  leadingWildcardLike: boolean;
  /** JOIN clauses counted via the SQL parser (0 if none or unparseable). */
  joinCount: number;
}

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
  filters?: QueryFilter[];
  isAggregate?: boolean;
  /** Raw-SQL-only signals consumed by SQL-specific rules. */
  sqlFlags?: SqlFlags;
  node: Node;
  inLoop: boolean;
  awaited: boolean;
  confidence: "high" | "heuristic";
}

export interface RuleContext {
  descriptors: QueryDescriptor[];
  knowledge?: Knowledge | null;
  cardinalityOf?: (d: QueryDescriptor) => Cardinality;
  loopBoundOf?: (d: QueryDescriptor) => Cardinality;
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
