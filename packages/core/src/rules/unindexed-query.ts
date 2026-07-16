import { basename } from "node:path";
import type { Rule, Diagnostic } from "../types.js";
import { makeDiagnostic } from "../types.js";
import { bucket } from "../knowledge/cardinality.js";

const LOGICAL = new Set(["AND", "OR", "NOT"]);
const DOCS = "https://github.com/AnujChhikara/cardinal#unindexed-query";

export const unindexedQueryRule: Rule = {
  id: "unindexed-query",
  defaultSeverity: "warning",
  match(ctx) {
    const schema = ctx.schema;
    if (!schema) return [];
    const out: Diagnostic[] = [];
    const schemaFile = basename(schema.filePath);

    for (const d of ctx.descriptors) {
      if (d.orm !== schema.orm || d.confidence !== "high" || d.operation !== "read") continue;
      const model = schema.models[d.target];
      if (!model) continue;

      // A provably-small table is cheap to scan — the knowledge file wins.
      const k = ctx.knowledge;
      const rows = k?.tables[d.target]?.rows;
      if (k && typeof rows === "number" && bucket(rows, k.thresholds) === "small") continue;

      const leading = new Set(model.indexes.map((ix) => ix[0]));
      const filters = d.filters ?? [];
      // Composite filters (AND/OR/NOT) aren't statically readable — stay silent.
      if (filters.some((f) => LOGICAL.has(f.field))) continue;
      // Only reason about fields we know are scalar columns of this model.
      const known = filters.filter((f) => model.fields.includes(f.field));
      const anyIndexed = known.some((f) => leading.has(f.field));

      if (known.length > 0 && !anyIndexed) {
        const names = known.map((f) => `"${f.field}"`).join(", ");
        const partial = model.indexes.find((ix) =>
          ix.slice(1).some((col) => known.some((f) => f.field === col)),
        );
        const hint = partial
          ? ` An index [${partial.join(", ")}] exists, but it only helps queries that also filter on "${partial[0]}".`
          : "";
        out.push(
          makeDiagnostic({
            ruleId: "unindexed-query",
            severity: "warning",
            message: `Query on "${d.target}" filters on ${names}, but no index has ${known.length > 1 ? "any of them" : "it"} as its leading column — the database scans the whole table.${hint} Add \`@@index([${known[0].field}])\` in ${schemaFile}.`,
            node: d.node,
            docsUrl: DOCS,
          }),
        );
        continue; // one diagnostic per query
      }

      const sortField = d.orderByFields?.[0];
      if (sortField && model.fields.includes(sortField) && !leading.has(sortField) && !anyIndexed) {
        out.push(
          makeDiagnostic({
            ruleId: "unindexed-query",
            severity: "warning",
            message: `Query on "${d.target}" sorts by "${sortField}", which has no index — the database sorts the entire table on every call. Add \`@@index([${sortField}])\` in ${schemaFile}.`,
            node: d.node,
            docsUrl: DOCS,
          }),
        );
      }
    }
    return out;
  },
};
