import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { analyzeSource } from "../engine.js";
import { parseSource, findCallExpressions } from "../parse.js";
import { prismaAdapter } from "../adapters/prisma.js";
import { heuristicAdapter } from "../adapters/heuristic.js";
import { computeAnchor } from "./suppress.js";
import { estimateCardinality } from "./cardinality.js";
import type { QueryDescriptor } from "../types.js";
import type { Knowledge, Suppression } from "./types.js";

export interface SuggestedFact {
  table: string;
  rows: number;
}
export interface SuppressPlan {
  suppression: Suppression;
  suggestedFact?: SuggestedFact;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function descriptorsOf(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf)
    .map((c) => prismaAdapter(c) ?? heuristicAdapter(c))
    .filter((d): d is QueryDescriptor => d !== null);
}

export function buildSuppressPlan(
  code: string,
  filePath: string,
  line: number,
  ruleId: string | undefined,
  k: Knowledge | null,
): SuppressPlan | { error: string } {
  const diags = analyzeSource(code, filePath, k).filter((d) => d.range.line === line && (!ruleId || d.ruleId === ruleId));
  if (diags.length === 0) return { error: `no diagnostic on ${filePath}:${line}${ruleId ? ` for rule ${ruleId}` : ""}` };
  if (diags.length > 1) return { error: `multiple diagnostics on line ${line}; pass --rule to choose (${diags.map((d) => d.ruleId).join(", ")})` };

  const diag = diags[0];
  const descriptors = descriptorsOf(code);
  const producer = descriptors.find((d) => d.node.getStart() === diag.range.start);
  if (!producer) return { error: "could not resolve the query for that diagnostic" };

  const { fn, anchor } = computeAnchor(producer.node);
  const suppression: Suppression = { rule: diag.ruleId, file: filePath, fn, anchor, added: today() };

  // Suggest a fact only when the producer's own cardinality is a known small filtered set.
  let suggestedFact: SuggestedFact | undefined;
  const card = estimateCardinality(producer, k);
  if (card.source === "filter" && card.bound === "small" && typeof card.count === "number") {
    suggestedFact = { table: producer.target, rows: card.count };
  }
  return { suppression, suggestedFact };
}

function loadRaw(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return { version: 1, tables: {}, suppressions: [] };
  const raw = parseYaml(readFileSync(filePath, "utf8"));
  if (typeof raw !== "object" || raw === null) return { version: 1, tables: {}, suppressions: [] };
  return raw as Record<string, unknown>;
}

function save(filePath: string, obj: Record<string, unknown>): void {
  writeFileSync(filePath, stringifyYaml(obj), "utf8");
}

export function addSuppression(filePath: string, s: Suppression): void {
  const obj = loadRaw(filePath);
  const list = Array.isArray(obj.suppressions) ? (obj.suppressions as Suppression[]) : [];
  list.push(s);
  obj.version = 1;
  obj.tables = obj.tables ?? {};
  obj.suppressions = list;
  save(filePath, obj);
}

export function addFact(filePath: string, table: string, rows: number): void {
  const obj = loadRaw(filePath);
  const tables = (obj.tables ?? {}) as Record<string, { rows?: number }>;
  tables[table] = { ...(tables[table] ?? {}), rows };
  obj.version = 1;
  obj.tables = tables;
  save(filePath, obj);
}
