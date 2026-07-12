import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Diagnostic, Severity } from "./types.js";

export type RuleSetting = Severity | "off";

export interface CardinalConfig {
  rules: Record<string, RuleSetting>;
  /** Absolute directory the config file lives in. */
  baseDir: string;
}

const FILE_NAMES = ["cardinal.config.json", "cardinal.config.yaml", "cardinal.config.yml"];
const VALID: ReadonlySet<string> = new Set(["error", "warning", "info", "off"]);

export function parseConfig(text: string, baseDir: string): CardinalConfig | null {
  let raw: unknown;
  try {
    raw = parseYaml(text); // also parses JSON
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const rules: Record<string, RuleSetting> = {};
  if (typeof obj.rules === "object" && obj.rules !== null) {
    for (const [id, setting] of Object.entries(obj.rules as Record<string, unknown>)) {
      if (typeof setting === "string" && VALID.has(setting)) {
        rules[id] = setting as RuleSetting;
      }
    }
  }
  return { rules, baseDir };
}

export function loadConfig(filePath: string): CardinalConfig | null {
  if (!existsSync(filePath)) return null;
  try {
    return parseConfig(readFileSync(filePath, "utf8"), dirname(filePath));
  } catch {
    return null;
  }
}

export function discoverConfig(fromDir: string): CardinalConfig | null {
  let dir = fromDir;
  while (true) {
    for (const name of FILE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return loadConfig(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) return null;
    dir = parent;
  }
}

/**
 * Applies rule settings to a diagnostic list: drops diagnostics for rules set to
 * "off" and overrides severity for rules given an explicit level. Rules absent
 * from the config keep their default severity. With no config, unchanged.
 */
export function applyConfig(
  diags: Diagnostic[],
  config: CardinalConfig | null | undefined,
): Diagnostic[] {
  if (!config) return diags;
  const out: Diagnostic[] = [];
  for (const d of diags) {
    const setting = config.rules[d.ruleId];
    if (setting === undefined) {
      out.push(d);
    } else if (setting === "off") {
      // dropped
    } else {
      out.push(d.severity === setting ? d : { ...d, severity: setting });
    }
  }
  return out;
}
