import type { Rule, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";

/** Number of JOIN clauses at or above which a query is flagged. */
const JOIN_THRESHOLD = 5;

export const excessiveJoinsRule: Rule = {
  id: "excessive-joins",
  defaultSeverity: "warning",
  match(ctx) {
    return ctx.descriptors
      .filter((d: QueryDescriptor) => (d.sqlFlags?.joinCount ?? 0) >= JOIN_THRESHOLD)
      .map((d: QueryDescriptor) =>
        makeDiagnostic({
          ruleId: "excessive-joins",
          severity: "warning",
          message: `Query joins ${d.sqlFlags!.joinCount + 1} tables (${d.sqlFlags!.joinCount} JOINs). Large join fan-out is hard for the planner and often signals a query doing too much — consider splitting it or denormalizing a hot path.`,
          node: d.node,
          docsUrl: "https://github.com/AnujChhikara/cardinal#excessive-joins",
        }),
      );
  },
};
