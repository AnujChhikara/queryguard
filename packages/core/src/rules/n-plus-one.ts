import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    return ctx.descriptors
      .filter((d) => d.inLoop)
      .map((d) =>
        makeDiagnostic({
          ruleId: "n-plus-one",
          severity: "error",
          message: `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`,
          node: d.node,
          docsUrl: "https://queryguard.dev/rules/n-plus-one",
        }),
      );
  },
};
