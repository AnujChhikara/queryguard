import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { buildSuppressPlan, addSuppression, addFact, discoverKnowledge, loadKnowledge } from "@cardinal/core";
import type { Knowledge } from "@cardinal/core";

export interface SuppressOptions {
  reason?: string;
  rule?: string;
  acceptFact?: boolean;
  knowledgePath?: string;
}

const KNOWLEDGE_FILENAME = "cardinal.knowledge.yaml";

export async function suppressCommand(
  target: string,
  cwd: string,
  opts: SuppressOptions,
  ask: (q: string) => Promise<string>,
): Promise<{ code: number; message: string }> {
  const m = /^(.*):(\d+)$/.exec(target);
  if (!m) return { code: 1, message: `invalid target "${target}" — expected <file>:<line>` };
  const relFile = m[1];
  const line = Number(m[2]);
  const abs = isAbsolute(relFile) ? relFile : join(cwd, relFile);

  let code: string;
  try {
    code = readFileSync(abs, "utf8");
  } catch {
    return { code: 1, message: `cannot read ${abs}` };
  }

  const knowledge: Knowledge | null = opts.knowledgePath
    ? loadKnowledge(opts.knowledgePath)
    : discoverKnowledge(cwd);

  const plan = buildSuppressPlan(code, relFile, line, opts.rule, knowledge);
  if ("error" in plan) return { code: 1, message: plan.error };

  const reason = opts.reason ?? (await ask("why are you suppressing this? (optional — Enter to skip) "));
  const suppression = { ...plan.suppression, reason: reason.trim() || undefined };

  const knowledgeFile = opts.knowledgePath ?? join(cwd, KNOWLEDGE_FILENAME);
  addSuppression(knowledgeFile, suppression);

  let factMsg = "";
  if (plan.suggestedFact) {
    const { table, rows } = plan.suggestedFact;
    const accept =
      opts.acceptFact ?? (await ask(`also record fact tables.${table}.rows = ${rows}? [y/N] `)).trim().toLowerCase() === "y";
    if (accept) {
      addFact(knowledgeFile, table, rows);
      factMsg = ` and recorded fact tables.${table}.rows=${rows}`;
    }
  }

  return { code: 0, message: `suppressed ${suppression.rule} at ${relFile}:${line}${factMsg}` };
}
