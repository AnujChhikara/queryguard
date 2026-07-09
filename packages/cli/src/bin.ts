#!/usr/bin/env node
import { run } from "./run.js";

async function main() {
  const patterns = process.argv.slice(2);
  if (patterns.length === 0) {
    console.error("usage: queryguard <glob> [glob...]");
    process.exit(2);
  }

  const { diagnostics, errorCount } = await run(patterns, process.cwd());

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
