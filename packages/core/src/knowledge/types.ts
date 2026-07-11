export type Bound = "small" | "medium" | "large" | "unknown";

export interface Cardinality {
  count?: number;
  bound: Bound;
  source: "filter" | "table" | "none";
}

export interface FilterFact {
  when: Record<string, string | number | boolean>;
  rows: number;
}

export interface TableFact {
  rows?: number;
  filters?: FilterFact[];
}

export interface Thresholds {
  small: number;
  large: number;
}

export interface Suppression {
  rule: string;
  file: string;
  fn: string;
  anchor: string;
  reason?: string;
  added?: string;
}

export interface Knowledge {
  version: 1;
  tables: Record<string, TableFact>;
  thresholds: Thresholds;
  suppressions: Suppression[];
  /** Absolute directory the knowledge file lives in — used to resolve suppression file paths. */
  baseDir: string;
}
