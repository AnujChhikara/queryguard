import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Knowledge, Thresholds } from "./types.js";

export * from "./types.js";

export const DEFAULT_THRESHOLDS: Thresholds = { small: 50, large: 1000 };

const FILE_NAMES = ["queryguard.knowledge.yaml", "queryguard.knowledge.yml", "queryguard.knowledge.json"];

export function parseKnowledge(text: string, baseDir: string): Knowledge | null {
  let raw: unknown;
  try {
    raw = parseYaml(text); // yaml.parse also accepts JSON
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.tables !== "object" || obj.tables === null || Array.isArray(obj.tables)) return null;

  const th = (obj.thresholds ?? {}) as Partial<Thresholds>;
  const thresholds: Thresholds = {
    small: typeof th.small === "number" ? th.small : DEFAULT_THRESHOLDS.small,
    large: typeof th.large === "number" ? th.large : DEFAULT_THRESHOLDS.large,
  };

  const suppressions = Array.isArray(obj.suppressions)
    ? (obj.suppressions as unknown[]).filter(
        (s): s is Knowledge["suppressions"][number] =>
          typeof s === "object" && s !== null &&
          typeof (s as Record<string, unknown>).rule === "string" &&
          typeof (s as Record<string, unknown>).file === "string" &&
          typeof (s as Record<string, unknown>).fn === "string" &&
          typeof (s as Record<string, unknown>).anchor === "string",
      )
    : [];

  return {
    version: 1,
    tables: obj.tables as Knowledge["tables"],
    thresholds,
    suppressions,
    baseDir,
  };
}

export function loadKnowledge(filePath: string): Knowledge | null {
  if (!existsSync(filePath)) return null;
  try {
    return parseKnowledge(readFileSync(filePath, "utf8"), dirname(filePath));
  } catch {
    return null;
  }
}

export function discoverKnowledge(fromDir: string): Knowledge | null {
  let dir = fromDir;
  // Walk up to filesystem root.
  while (true) {
    for (const name of FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return loadKnowledge(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) return null;
    dir = parent;
  }
}
