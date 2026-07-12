import type { Rule, QueryDescriptor } from "../types.js";
import { makeDiagnostic } from "../types.js";
import { bucket } from "../knowledge/cardinality.js";

export const overFetchRule: Rule = {
  id: "over-fetch",
  defaultSeverity: "warning",
  match(ctx) {
    const k = ctx.knowledge;
    if (!k) return [];
    return ctx.descriptors
      .filter(
        (d: QueryDescriptor) =>
          d.operation === "read" && d.isAggregate !== true && d.hasFilter === false,
      )
      .flatMap((d: QueryDescriptor) => {
        const table = k.tables[d.target];
        if (!table || typeof table.rows !== "number") return [];
        if (bucket(table.rows, k.thresholds) !== "large") return [];
        const smallFilter = (table.filters ?? []).find((f) => bucket(f.rows, k.thresholds) === "small");
        if (!smallFilter) return [];
        const pred = Object.entries(smallFilter.when)
          .map(([key, val]) => `${key}=${String(val)}`)
          .join(", ");
        return [
          makeDiagnostic({
            ruleId: "over-fetch",
            severity: "warning",
            message: `Read on "${d.target}" loads all ~${table.rows} rows, but a "${pred}" (~${smallFilter.rows}) subset likely suffices. Add a where, or confirm you need the full table.`,
            node: d.node,
            docsUrl: "https://github.com/AnujChhikara/cardinal#over-fetch",
          }),
        ];
      });
  },
};
