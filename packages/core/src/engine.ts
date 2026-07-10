import { parseSource, findCallExpressions } from "./parse.js";
import { prismaAdapter } from "./adapters/prisma.js";
import { heuristicAdapter } from "./adapters/heuristic.js";
import { nPlusOneRule } from "./rules/n-plus-one.js";
import type { Diagnostic, QueryDescriptor, Rule } from "./types.js";
import type { CallExpression } from "ts-morph";

const adapters: Array<(call: CallExpression) => QueryDescriptor | null> = [prismaAdapter, heuristicAdapter];
const rules: Rule[] = [nPlusOneRule];

export function analyzeSource(code: string, filePath?: string): Diagnostic[] {
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

  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    try {
      diagnostics.push(...rule.match({ descriptors }));
    } catch {
      // Best-effort: a throwing rule is skipped, never fatal.
    }
  }
  return diagnostics;
}
