import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import fg from "fast-glob";
import { collectQueries, buildKnowledgeScaffold } from "cardinal-core";
import type { QueryDescriptor } from "cardinal-core";

const DEFAULT_GLOB = "**/*.{ts,js,tsx,jsx}";
const KNOWLEDGE_FILE = "cardinal.knowledge.yaml";

export interface InitOptions {
  force?: boolean;
}

/**
 * Scaffolds a cardinal.knowledge.yaml from the queries found in the codebase:
 * every table, plus the eq-filter subsets the code queries by, each with a count
 * query to run. Refuses to overwrite an existing file unless `force`.
 */
export async function initCommand(
  patterns: string[],
  cwd: string,
  opts: InitOptions = {},
): Promise<{ code: number; message: string }> {
  const target = join(cwd, KNOWLEDGE_FILE);
  if (existsSync(target) && !opts.force) {
    return { code: 1, message: `${KNOWLEDGE_FILE} already exists (use --force to overwrite)` };
  }

  const globs = patterns.length > 0 ? patterns : [DEFAULT_GLOB];
  const files = await fg(globs, {
    cwd,
    absolute: false,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.astro/**"],
  });

  const descriptors: QueryDescriptor[] = [];
  for (const file of files) {
    let code: string;
    try {
      code = await readFile(join(cwd, file), "utf8");
    } catch {
      continue;
    }
    descriptors.push(...collectQueries(code, join(cwd, file)));
  }

  const tables = new Set(
    descriptors
      .filter((d) => d.confidence !== "heuristic" && d.target && d.target !== "unknown")
      .map((d) => d.target),
  );

  await writeFile(target, buildKnowledgeScaffold(descriptors), "utf8");
  return {
    code: 0,
    message:
      tables.size === 0
        ? `wrote ${KNOWLEDGE_FILE} (no queries found yet)`
        : `wrote ${KNOWLEDGE_FILE} with ${tables.size} table(s) — fill in the row counts`,
  };
}
