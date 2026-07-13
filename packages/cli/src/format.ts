import { explainRule } from "cardinal-core";
import type { FileDiagnostic } from "./run.js";

/**
 * Machine-readable output for AI agents / CI bots. Each finding carries its
 * location, message (which embeds the specifics — target, cardinality), and the
 * reusable why/fix explanation so an agent can apply the fix.
 */
export function formatJson(diagnostics: FileDiagnostic[], errorCount: number): string {
  const findings = diagnostics.map((d) => {
    const explanation = explainRule(d.ruleId);
    return {
      ruleId: d.ruleId,
      severity: d.severity,
      file: d.file,
      line: d.range.line,
      column: d.range.column,
      message: d.message,
      ...(d.docsUrl ? { docsUrl: d.docsUrl } : {}),
      ...(explanation ? { explanation } : {}),
    };
  });

  return JSON.stringify(
    {
      tool: "cardinal",
      version: 1,
      summary: { problems: diagnostics.length, errors: errorCount },
      findings,
    },
    null,
    2,
  );
}
