import { analyzeSource, type Diagnostic, type Knowledge } from "@cardinal/core";

export interface MappedDiagnostic {
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning" | "info";
  ruleId: string;
  message: string;
}

/**
 * Runs the Cardinal engine on a source string and maps each diagnostic to a
 * neutral, editor-agnostic shape carrying absolute character offsets.
 * Best-effort: never throws — returns [] on any engine error.
 *
 * When a `knowledge` object is supplied, the engine becomes scale-aware:
 * provably-small loops are silenced, provably-large fan-out is escalated, and
 * the over-fetch rule can fire. With `knowledge` omitted, output is unchanged.
 */
export function toVsDiagnostics(
  code: string,
  fileName: string,
  knowledge?: Knowledge | null,
): MappedDiagnostic[] {
  let diagnostics: Diagnostic[];
  try {
    diagnostics = analyzeSource(code, fileName, knowledge ?? null);
  } catch {
    return [];
  }
  return diagnostics.map((d) => ({
    startOffset: d.range.start,
    endOffset: d.range.end,
    severity: d.severity,
    ruleId: d.ruleId,
    message: d.message,
  }));
}
