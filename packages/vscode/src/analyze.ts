import { analyzeSource, type Diagnostic } from "@queryguard/core";

export interface MappedDiagnostic {
  startOffset: number;
  endOffset: number;
  severity: "error" | "warning" | "info";
  ruleId: string;
  message: string;
}

/**
 * Runs the QueryGuard engine on a source string and maps each diagnostic to a
 * neutral, editor-agnostic shape carrying absolute character offsets.
 * Best-effort: never throws — returns [] on any engine error.
 */
export function toVsDiagnostics(code: string, fileName: string): MappedDiagnostic[] {
  let diagnostics: Diagnostic[];
  try {
    diagnostics = analyzeSource(code, fileName);
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
