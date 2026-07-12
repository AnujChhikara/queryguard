import type { Rule } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const unboundedReadRule: Rule = {
  id: "unbounded-read",
  defaultSeverity: "warning",
  match(ctx) {
    return ctx.descriptors
      .filter(
        (d) =>
          d.operation === "read" &&
          d.isAggregate !== true &&
          d.hasFilter === false &&
          d.hasLimit === false,
      )
      .map((d) =>
        makeDiagnostic({
          ruleId: "unbounded-read",
          severity: "warning",
          message: `Read on "${d.target}" has no filter and no limit — this may scan the whole table. Add a WHERE/where or a LIMIT/take.`,
          node: d.node,
          docsUrl: "https://cardinal.dev/rules/unbounded-read",
        }),
      );
  },
};
