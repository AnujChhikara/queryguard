import { existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import {
  discoverKnowledge,
  buildSuppressPlan,
  addSuppression,
  addFact,
  type Knowledge,
} from "cardinal-core";

const KNOWLEDGE_NAMES = [
  "cardinal.knowledge.yaml",
  "cardinal.knowledge.yml",
  "cardinal.knowledge.json",
];
const DEFAULT_KNOWLEDGE_FILE = "cardinal.knowledge.yaml";

export interface SuppressIO {
  /** Resolves the reason text, or `undefined` if the user cancelled. */
  askReason: () => Promise<string | undefined>;
  confirmFact: (table: string, rows: number) => Promise<boolean>;
}

export interface SuppressParams {
  code: string;
  absPath: string;
  relPath: string;
  line: number;
  ruleId: string;
  workspaceRoot?: string;
}

export type SuppressResult =
  | { ok: true; message: string; knowledgeFile: string }
  | { ok: false; error: string };

/**
 * The path of an existing cardinal.knowledge.* found by walking up from
 * `fromDir`, or a new default file at `fallbackDir` when none exists.
 */
export function resolveKnowledgeFilePath(fromDir: string, fallbackDir: string): string {
  let dir = fromDir;
  while (true) {
    for (const name of KNOWLEDGE_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) break;
    dir = parent;
  }
  return join(fallbackDir, DEFAULT_KNOWLEDGE_FILE);
}

/**
 * Editor-agnostic suppression: plan the suppression for a diagnostic, ask for a
 * reason, write it to the knowledge file, and optionally promote an implied
 * cardinality fact. UI interactions are injected via `io` so this is testable
 * without vscode. `code` is the (possibly unsaved) editor buffer text.
 */
export async function performSuppression(
  params: SuppressParams,
  io: SuppressIO,
): Promise<SuppressResult> {
  const { code, absPath, relPath, line, ruleId, workspaceRoot } = params;
  const fromDir = dirname(absPath);
  const knowledge: Knowledge | null = discoverKnowledge(fromDir);

  const plan = buildSuppressPlan(code, relPath, line, ruleId, knowledge);
  if ("error" in plan) return { ok: false, error: plan.error };

  const reason = await io.askReason();
  if (reason === undefined) return { ok: false, error: "cancelled" };

  const knowledgeFile = resolveKnowledgeFilePath(fromDir, workspaceRoot ?? fromDir);
  addSuppression(knowledgeFile, { ...plan.suppression, reason: reason.trim() || undefined });

  let factMsg = "";
  if (plan.suggestedFact) {
    const { table, rows } = plan.suggestedFact;
    if (await io.confirmFact(table, rows)) {
      addFact(knowledgeFile, table, rows);
      factMsg = ` and recorded tables.${table}.rows=${rows}`;
    }
  }

  return {
    ok: true,
    message: `Suppressed ${plan.suppression.rule} at ${relPath}:${line}${factMsg}`,
    knowledgeFile,
  };
}
