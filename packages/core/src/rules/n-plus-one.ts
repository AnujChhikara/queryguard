import type { Rule, Cardinality, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";

const UNKNOWN: Cardinality = { bound: "unknown", source: "none" };

export const nPlusOneRule: Rule = {
  id: "n-plus-one",
  defaultSeverity: "error",
  match(ctx) {
    const loopBoundOf = ctx.loopBoundOf ?? (() => UNKNOWN);
    return ctx.descriptors
      .filter((d: QueryDescriptor) => d.inLoop)
      .flatMap((d: QueryDescriptor) => {
        const { bound, count } = loopBoundOf(d);
        if (bound === "small") return []; // provably bounded — suppress

        if (bound === "large") {
          const amount = count ? `~${count}` : "a large";
          return [
            makeDiagnostic({
              ruleId: "n-plus-one",
              severity: "error",
              message: `Query on "${d.target}" runs once per row of ${amount}-row set (N+1 amplified). Batch it into a single query (e.g. a WHERE ... IN / findMany).`,
              node: d.node,
              docsUrl: "https://cardinal.dev/rules/n-plus-one",
            }),
          ];
        }

        const severity = d.confidence === "high" ? "error" : "warning";
        const message =
          d.confidence === "high"
            ? `Query on "${d.target}" runs inside a loop (N+1). Batch it into a single query (e.g. a WHERE ... IN / findMany).`
            : `Possible N+1: "${d.target}" looks like a query called inside a loop. If it hits the database, batch it into a single query.`;
        return [
          makeDiagnostic({
            ruleId: "n-plus-one",
            severity,
            message,
            node: d.node,
            docsUrl: "https://cardinal.dev/rules/n-plus-one",
          }),
        ];
      });
  },
};
