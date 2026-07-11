#!/usr/bin/env node
import { discoverKnowledge, loadKnowledge } from "@queryguard/core";
import type { Knowledge } from "@queryguard/core";
import { run } from "./run.js";

function parseArgs(argv: string[]): { patterns: string[]; knowledgePath?: string; noKnowledge: boolean } {
  const patterns: string[] = [];
  let knowledgePath: string | undefined;
  let noKnowledge = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-knowledge") noKnowledge = true;
    else if (a === "--knowledge") knowledgePath = argv[++i];
    else patterns.push(a);
  }
  return { patterns, knowledgePath, noKnowledge };
}

async function main() {
  const { patterns, knowledgePath, noKnowledge } = parseArgs(process.argv.slice(2));
  if (patterns.length === 0) {
    console.error("usage: queryguard [--knowledge <path>] [--no-knowledge] <glob> [glob...]");
    process.exit(2);
  }

  let knowledge: Knowledge | null = null;
  if (!noKnowledge) {
    knowledge = knowledgePath ? loadKnowledge(knowledgePath) : discoverKnowledge(process.cwd());
    if (knowledge) console.error(`queryguard: using knowledge from ${knowledgePath ?? "queryguard.knowledge.yaml"}`);
  }

  const { diagnostics, errorCount } = await run(patterns, process.cwd(), { knowledge });

  for (const d of diagnostics) {
    console.log(`${d.file}:${d.range.line}:${d.range.column}  ${d.severity}  ${d.ruleId}  ${d.message}`);
  }
  console.log(`\n${diagnostics.length} problem(s), ${errorCount} error(s)`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
