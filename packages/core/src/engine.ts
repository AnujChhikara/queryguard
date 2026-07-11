import { parseSource, findCallExpressions } from "./parse.js";
import { prismaAdapter } from "./adapters/prisma.js";
import { heuristicAdapter } from "./adapters/heuristic.js";
import { nPlusOneRule } from "./rules/n-plus-one.js";
import { unboundedReadRule } from "./rules/unbounded-read.js";
import { overFetchRule } from "./rules/over-fetch.js";
import { estimateCardinality } from "./knowledge/cardinality.js";
import { resolveDrivingSet } from "./knowledge/driving-set.js";
import { readInlineHint } from "./knowledge/hints.js";
import { filterSuppressed } from "./knowledge/suppress.js";
import type { Knowledge, Cardinality } from "./knowledge/types.js";
import type { Diagnostic, QueryDescriptor, Rule } from "./types.js";
import type { CallExpression } from "ts-morph";

const adapters: Array<(call: CallExpression) => QueryDescriptor | null> = [prismaAdapter, heuristicAdapter];
const rules: Rule[] = [nPlusOneRule, unboundedReadRule, overFetchRule];

export function analyzeSource(
  code: string,
  filePath?: string,
  knowledge?: Knowledge | null,
): Diagnostic[] {
  const sf = parseSource(code, filePath);
  const calls = findCallExpressions(sf);

  const descriptors: QueryDescriptor[] = [];
  for (const call of calls) {
    for (const adapter of adapters) {
      const descriptor = adapter(call);
      if (descriptor) {
        descriptors.push(descriptor);
        break;
      }
    }
  }

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
  return filterSuppressed(diagnostics, descriptors, filePath, knowledge);
}
