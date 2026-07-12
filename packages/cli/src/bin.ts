#!/usr/bin/env node
import { discoverKnowledge, loadKnowledge } from "@cardinal/core";
import type { Knowledge } from "@cardinal/core";
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
  const argv = process.argv.slice(2);
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

  const { patterns, knowledgePath, noKnowledge } = parseArgs(argv);
  if (patterns.length === 0) {
    console.error("usage: cardinal [--knowledge <path>] [--no-knowledge] <glob> [glob...]");
    process.exit(2);
  }

  let knowledge: Knowledge | null = null;
  if (!noKnowledge) {
    knowledge = knowledgePath ? loadKnowledge(knowledgePath) : discoverKnowledge(process.cwd());
    if (knowledge) console.error(`cardinal: using knowledge from ${knowledgePath ?? "cardinal.knowledge.yaml"}`);
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
