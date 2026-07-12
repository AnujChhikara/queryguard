import type { Rule, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";

export const leadingWildcardLikeRule: Rule = {
  id: "leading-wildcard-like",
  defaultSeverity: "warning",
  match(ctx) {
    return ctx.descriptors
      .filter((d: QueryDescriptor) => d.sqlFlags?.leadingWildcardLike === true)
      .map((d: QueryDescriptor) =>
        makeDiagnostic({
          ruleId: "leading-wildcard-like",
          severity: "warning",
          message:
            "LIKE with a leading '%' wildcard can't use an index and scans the whole table. Anchor the pattern (e.g. 'abc%') or use a full-text search index for contains-style matches.",
          node: d.node,
          docsUrl: "https://cardinal.dev/rules/leading-wildcard-like",
        }),
      );
  },
};
