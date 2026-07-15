#!/usr/bin/env node
import { discoverKnowledge, loadKnowledge, discoverConfig, discoverSchema, loadSchema } from "cardinal-core";
import type { Knowledge, CardinalConfig, SchemaInfo } from "cardinal-core";
import { run } from "./run.js";

function parseArgs(argv: string[]): {
  patterns: string[];
  knowledgePath?: string;
  noKnowledge: boolean;
  schemaPath?: string;
  noSchema: boolean;
  noConfig: boolean;
  format: "text" | "json";
} {
  const patterns: string[] = [];
  let knowledgePath: string | undefined;
  let noKnowledge = false;
  let schemaPath: string | undefined;
  let noSchema = false;
  let noConfig = false;
  let format: "text" | "json" = "text";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-knowledge") noKnowledge = true;
    else if (a === "--no-config") noConfig = true;
    else if (a === "--knowledge") knowledgePath = argv[++i];
    else if (a === "--no-schema") noSchema = true;
    else if (a === "--schema") schemaPath = argv[++i];
    else if (a === "--format") format = argv[++i] === "json" ? "json" : "text";
    else patterns.push(a);
  }
  return { patterns, knowledgePath, noKnowledge, schemaPath, noSchema, noConfig, format };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "init") {
    const rest = argv.slice(1);
    const patterns = rest.filter((a) => !a.startsWith("--"));
    const { initCommand } = await import("./init.js");
    const res = await initCommand(patterns, process.cwd(), { force: rest.includes("--force") });
    console.log(res.message);
    process.exit(res.code);
  }
  if (argv[0] === "suppress") {
    const { createInterface } = await import("node:readline/promises");
    const rest = argv.slice(1);
    const target = rest.find((a) => !a.startsWith("--")) ?? "";
    const idx = (name: string) => rest.indexOf(name);
    const opt = (name: string) => (idx(name) >= 0 ? rest[idx(name) + 1] : undefined);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (q: string) => (await rl.question(q)).trim();
    const { suppressCommand } = await import("./suppress.js");
    const res = await suppressCommand(
      target,
      process.cwd(),
      { reason: opt("--reason"), rule: opt("--rule"), acceptFact: rest.includes("--yes"), knowledgePath: opt("--knowledge") },
      ask,
    );
    rl.close();
    console.log(res.message);
    process.exit(res.code);
  }

  const { patterns, knowledgePath, noKnowledge, schemaPath, noSchema, noConfig, format } = parseArgs(argv);
  if (patterns.length === 0) {
    console.error(
      "usage:\n" +
        "  cardinal [--knowledge <path>] [--no-knowledge] [--schema <path>] [--no-schema] [--no-config] [--format text|json] <glob> [glob...]\n" +
        "  cardinal init [glob...] [--force]     scaffold a cardinal.knowledge.yaml\n" +
        "  cardinal suppress <file>:<line>       silence a finding",
    );
    process.exit(2);
  }

  let knowledge: Knowledge | null = null;
  if (!noKnowledge) {
    knowledge = knowledgePath ? loadKnowledge(knowledgePath) : discoverKnowledge(process.cwd());
    if (knowledge) console.error(`cardinal: using knowledge from ${knowledgePath ?? "cardinal.knowledge.yaml"}`);
  }

  let config: CardinalConfig | null = null;
  if (!noConfig) {
    config = discoverConfig(process.cwd());
    if (config) console.error("cardinal: using config from cardinal.config");
  }

  let schema: SchemaInfo | null = null;
  if (!noSchema) {
    schema = schemaPath ? loadSchema(schemaPath) : discoverSchema(process.cwd());
    if (schema) console.error(`cardinal: using schema from ${schema.filePath}`);
  }

  const { diagnostics, errorCount } = await run(patterns, process.cwd(), { knowledge, config, schema });

  if (format === "json") {
    const { formatJson } = await import("./format.js");
    console.log(formatJson(diagnostics, errorCount));
  } else {
    for (const d of diagnostics) {
      console.log(`${d.file}:${d.range.line}:${d.range.column}  ${d.severity}  ${d.ruleId}  ${d.message}`);
    }
    console.log(`\n${diagnostics.length} problem(s), ${errorCount} error(s)`);
  }
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
