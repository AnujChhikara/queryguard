import type { QueryDescriptor } from "../types.js";
import type { Bound, Cardinality, Knowledge, Thresholds } from "./types.js";

export function bucket(count: number, t: Thresholds): Bound {
  if (count <= t.small) return "small";
  if (count >= t.large) return "large";
  return "medium";
}

export function estimateCardinality(
  d: QueryDescriptor,
  k: Knowledge | null | undefined,
): Cardinality {
  if (!k) return { bound: "unknown", source: "none" };
  const table = k.tables[d.target];
  if (!table) return { bound: "unknown", source: "none" };

  // eq predicates the query actually applies, as field -> value.
  const eq = new Map<string, string | number | boolean>();
  for (const f of d.filters ?? []) {
    if (f.kind === "eq" && f.value !== undefined) eq.set(f.field, f.value);
  }

  // Matching filter facts: every `when` key present in the query's eq predicates
  // with an equal value (query filters are a superset of `when`). Pick the tightest.
  let best: number | undefined;
  for (const fact of table.filters ?? []) {
    if (typeof fact.rows !== "number") continue; // unfilled scaffold / invalid → ignore
    const matches = Object.entries(fact.when).every(([key, val]) => eq.get(key) === val);
    if (matches && (best === undefined || fact.rows < best)) best = fact.rows;
  }
  if (best !== undefined) {
    return { count: best, bound: bucket(best, k.thresholds), source: "filter" };
  }

  if (d.hasFilter === false && typeof table.rows === "number") {
    return { count: table.rows, bound: bucket(table.rows, k.thresholds), source: "table" };
  }

  return { bound: "unknown", source: "none" };
}
