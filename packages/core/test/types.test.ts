import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { makeDiagnostic } from "../src/types.js";

describe("makeDiagnostic", () => {
  it("builds a diagnostic with a range derived from the node", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("t.ts", "const x = 1;");
    const node = sf.getFirstDescendantOrThrow((n) => n.getText() === "1");

    const diag = makeDiagnostic({
      ruleId: "test-rule",
      severity: "error",
      message: "boom",
      node,
      docsUrl: "https://example.com",
    });

    expect(diag.ruleId).toBe("test-rule");
    expect(diag.severity).toBe("error");
    expect(diag.message).toBe("boom");
    expect(diag.docsUrl).toBe("https://example.com");
    expect(diag.range.start).toBe(node.getStart());
    expect(diag.range.end).toBe(node.getEnd());
    expect(diag.range.line).toBeGreaterThanOrEqual(1);
    expect(diag.range.column).toBeGreaterThanOrEqual(1);
  });
});
