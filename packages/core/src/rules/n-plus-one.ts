import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    return ctx.descriptors
      .filter((d) => d.inLoop)
      .map((d) => {
        const severity = d.confidence === "high" ? "error" : "warning";
        const message =
          d.confidence === "high"
            ? `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`
            : `Possible N+1: "${d.target}" looks like a query called inside a loop. If it hits the database, batch it into a single query.`;
        return makeDiagnostic({
          ruleId: "n-plus-one",
          severity,
          message,
          node: d.node,
          docsUrl: "https://queryguard.dev/rules/n-plus-one",
        });
      });
  },
};
