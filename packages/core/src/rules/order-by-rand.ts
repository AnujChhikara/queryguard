import type { Rule, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const orderByRandRule: Rule = {
  id: "order-by-rand",
  defaultSeverity: "warning",
  match(ctx) {
    return ctx.descriptors
      .filter((d: QueryDescriptor) => d.sqlFlags?.orderByRand === true)
      .map((d: QueryDescriptor) =>
        makeDiagnostic({
          ruleId: "order-by-rand",
          severity: "warning",
          message:
            "ORDER BY RAND() sorts the entire result set and can't use an index — it gets slower as the table grows. For a random row, prefer a keyed lookup on a random id or a random OFFSET.",
          node: d.node,
          docsUrl: "https://github.com/AnujChhikara/cardinal#order-by-rand",
        }),
      );
  },
};
