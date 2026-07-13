import { parseSource, findQueryCandidates } from "./parse.js";
import { prismaAdapter } from "./adapters/prisma.js";
import { drizzleAdapter } from "./adapters/drizzle.js";
import { mongooseAdapter } from "./adapters/mongoose.js";
import { rawSqlAdapter } from "./adapters/raw-sql.js";
import { heuristicAdapter } from "./adapters/heuristic.js";
import { nPlusOneRule } from "./rules/n-plus-one.js";
import { unboundedReadRule } from "./rules/unbounded-read.js";
import { overFetchRule } from "./rules/over-fetch.js";
import { orderByRandRule } from "./rules/order-by-rand.js";
import { leadingWildcardLikeRule } from "./rules/leading-wildcard-like.js";
import { excessiveJoinsRule } from "./rules/excessive-joins.js";
import { estimateCardinality } from "./knowledge/cardinality.js";
import { resolveDrivingSet } from "./knowledge/driving-set.js";
import { readInlineHint } from "./knowledge/hints.js";
import { filterSuppressed } from "./knowledge/suppress.js";
import { applyConfig } from "./config.js";
import type { CardinalConfig } from "./config.js";
import type { Knowledge, Cardinality } from "./knowledge/types.js";
import type { Diagnostic, QueryDescriptor, Rule } from "./types.js";
import type { Node } from "ts-morph";

// Drizzle before Prisma: `db.query.<table>.findMany` also fits Prisma's
// `base.model.method` shape, so the more specific `.query.` matcher must win.
const adapters: Array<(node: Node) => QueryDescriptor | null> = [drizzleAdapter, prismaAdapter, mongooseAdapter, rawSqlAdapter, heuristicAdapter];
const rules: Rule[] = [
  nPlusOneRule,
  unboundedReadRule,
  overFetchRule,
  orderByRandRule,
  leadingWildcardLikeRule,
  excessiveJoinsRule,
];

/** Every query Cardinal recognizes in a source string (first matching adapter wins). */
export function collectQueries(code: string, filePath?: string): QueryDescriptor[] {
  const sf = parseSource(code, filePath);
  const descriptors: QueryDescriptor[] = [];
  for (const candidate of findQueryCandidates(sf)) {
    for (const adapter of adapters) {
      const descriptor = adapter(candidate);
      if (descriptor) {
        descriptors.push(descriptor);
        break;
      }
    }
  }
  return descriptors;
}

export function analyzeSource(
  code: string,
  filePath?: string,
  knowledge?: Knowledge | null,
  config?: CardinalConfig | null,
): Diagnostic[] {
  const descriptors = collectQueries(code, filePath);

  const cardCache = new Map<QueryDescriptor, Cardinality>();
  const cardinalityOf = (d: QueryDescriptor): Cardinality => {
    let c = cardCache.get(d);
    if (!c) {
      c = estimateCardinality(d, knowledge);
      cardCache.set(d, c);
    }
    return c;
  };

  const loopCache = new Map<QueryDescriptor, Cardinality>();
  const loopBoundOf = (d: QueryDescriptor): Cardinality => {
    let c = loopCache.get(d);
    if (c) return c;
    if (!d.inLoop) {
      c = { bound: "unknown", source: "none" };
    } else {
      const hint = readInlineHint(d.node);
      if (hint?.kind === "bounded") c = { count: hint.count, bound: "small", source: "none" };
      else if (hint?.kind === "unbounded") c = { bound: "large", source: "none" };
      else c = resolveDrivingSet(d, descriptors, knowledge);
    }
    loopCache.set(d, c);
    return c;
  };

  const ctx = { descriptors, knowledge, cardinalityOf, loopBoundOf };

  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    try {
      diagnostics.push(...rule.match(ctx));
    } catch {
      // Best-effort: a throwing rule is skipped, never fatal.
    }
  }
  const suppressed = filterSuppressed(diagnostics, descriptors, filePath, knowledge);
  return applyConfig(suppressed, config);
}
