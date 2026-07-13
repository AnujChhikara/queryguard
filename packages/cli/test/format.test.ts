import { describe, it, expect } from "vitest";
import { formatJson } from "../src/format.js";
import type { FileDiagnostic } from "../src/run.js";

function diag(over: Partial<FileDiagnostic> = {}): FileDiagnostic {
  return {
    ruleId: "n-plus-one",
    severity: "error",
    message: "Query on \"post\" runs inside a loop (N+1).",
    docsUrl: "https://example/#n-plus-one",
    file: "src/orders.ts",
    range: { start: 100, end: 140, line: 12, column: 8 },
    ...over,
  };
}

describe("formatJson", () => {
  it("emits valid JSON with the tool wrapper and summary counts", () => {
    const out = formatJson([diag(), diag({ severity: "warning", ruleId: "unbounded-read" })], 1);
    const parsed = JSON.parse(out);
    expect(parsed.tool).toBe("cardinal");
    expect(parsed.version).toBe(1);
    expect(parsed.summary).toEqual({ problems: 2, errors: 1 });
    expect(parsed.findings).toHaveLength(2);
  });

  it("maps each diagnostic to file/line/column and attaches the rule explanation", () => {
    const parsed = JSON.parse(formatJson([diag()], 1));
    const f = parsed.findings[0];
    expect(f.ruleId).toBe("n-plus-one");
    expect(f.severity).toBe("error");
    expect(f.file).toBe("src/orders.ts");
    expect(f.line).toBe(12);
    expect(f.column).toBe(8);
    expect(f.message).toContain("N+1");
    expect(f.docsUrl).toBe("https://example/#n-plus-one");
    expect(f.explanation.why.length).toBeGreaterThan(0);
    expect(f.explanation.fix.length).toBeGreaterThan(0);
  });

  it("omits explanation for a rule id with no registered explanation", () => {
    const parsed = JSON.parse(formatJson([diag({ ruleId: "mystery-rule" })], 1));
    expect(parsed.findings[0].explanation).toBeUndefined();
  });

  it("produces an empty findings array for no diagnostics", () => {
    const parsed = JSON.parse(formatJson([], 0));
    expect(parsed.findings).toEqual([]);
    expect(parsed.summary).toEqual({ problems: 0, errors: 0 });
  });
});
