import type { QueryDescriptor } from "../types.js";

// id, _id, camelCase foreign keys (authorId), snake_case (author_id) — point
// lookups, not stable category subsets, so they're excluded from candidate facts.
const ID_FIELD = /^_?id$|Id$|_id$/;

interface Candidate {
  field: string;
  value: string | number | boolean;
  count: number;
}

const yamlValue = (v: string | number | boolean): string => String(v);
const sqlValue = (v: string | number | boolean): string => (typeof v === "string" ? `'${v}'` : String(v));
const mongoValue = (v: string | number | boolean): string => (typeof v === "string" ? `"${v}"` : String(v));

/**
 * Builds a starter cardinal.knowledge.yaml (as a string, so the guiding comments
 * survive) from the queries found in a codebase: every table, plus the eq-filter
 * subsets the code actually queries by, each with a copy-pasteable count query.
 * Row counts are left empty (the one thing only the user knows).
 */
export function buildKnowledgeScaffold(descriptors: QueryDescriptor[]): string {
  const byTable = new Map<string, QueryDescriptor[]>();
  for (const d of descriptors) {
    if (d.confidence === "heuristic" || !d.target || d.target === "unknown") continue;
    const list = byTable.get(d.target) ?? [];
    list.push(d);
    byTable.set(d.target, list);
  }

  const lines: string[] = [
    "version: 1",
    "# Fill in real row counts and prune any filters you don't need, then Cardinal",
    "# reasons about your data's scale.",
    "# Docs: https://github.com/AnujChhikara/cardinal#business-logic-context",
    "thresholds:",
    "  small: 50",
    "  large: 1000",
    "tables:",
  ];

  for (const table of [...byTable.keys()].sort()) {
    const ds = byTable.get(table)!;
    const mongo = ds.some((d) => d.orm === "mongoose");
    const countAll = mongo ? `db.${table}.countDocuments()` : `SELECT count(*) FROM ${table};`;
    lines.push(`  ${table}:`);
    lines.push(`    rows:  # ${countAll}`);

    const candidates = new Map<string, Candidate>();
    for (const d of ds) {
      for (const f of d.filters ?? []) {
        if (f.kind !== "eq" || f.value === undefined || ID_FIELD.test(f.field)) continue;
        const key = `${f.field}=${String(f.value)}`;
        const existing = candidates.get(key);
        if (existing) existing.count++;
        else candidates.set(key, { field: f.field, value: f.value, count: 1 });
      }
    }

    const cands = [...candidates.values()].sort((a, b) => b.count - a.count || a.field.localeCompare(b.field));
    if (cands.length === 0) continue;
    lines.push("    filters:");
    for (const c of cands) {
      const countFiltered = mongo
        ? `db.${table}.countDocuments({ ${c.field}: ${mongoValue(c.value)} })`
        : `SELECT count(*) FROM ${table} WHERE ${c.field} = ${sqlValue(c.value)};`;
      lines.push(`      - when: { ${c.field}: ${yamlValue(c.value)} }  # seen ${c.count}×`);
      lines.push(`        rows:  # ${countFiltered}`);
    }
  }

  return lines.join("\n") + "\n";
}
