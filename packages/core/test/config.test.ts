import { describe, it, expect } from "vitest";
import { parseConfig, applyConfig } from "../src/config.js";
import type { Diagnostic } from "../src/types.js";

function diag(ruleId: string, severity: Diagnostic["severity"]): Diagnostic {
  return { ruleId, severity, message: "m", range: { start: 0, end: 1, line: 1, column: 1 } };
}

describe("parseConfig", () => {
  it("parses a rules map", () => {
    const c = parseConfig(`{ "rules": { "n-plus-one": "off", "over-fetch": "error" } }`, "/p")!;
    expect(c).not.toBeNull();
    expect(c.rules["n-plus-one"]).toBe("off");
    expect(c.rules["over-fetch"]).toBe("error");
    expect(c.baseDir).toBe("/p");
  });

  it("parses yaml too and defaults rules to empty when absent", () => {
    const c = parseConfig(`rules:\n  unbounded-read: warning\n`, "/p")!;
    expect(c.rules["unbounded-read"]).toBe("warning");
    const empty = parseConfig(`{}`, "/p")!;
    expect(empty.rules).toEqual({});
  });

  it("returns null on malformed input and ignores non-string settings", () => {
    expect(parseConfig(`: : :`, "/p")).toBeNull();
    const c = parseConfig(`{ "rules": { "n-plus-one": 5, "over-fetch": "off" } }`, "/p")!;
    expect(c.rules["n-plus-one"]).toBeUndefined();
    expect(c.rules["over-fetch"]).toBe("off");
  });
});

describe("applyConfig", () => {
  const diags = [diag("n-plus-one", "error"), diag("unbounded-read", "warning")];

  it("returns diagnostics unchanged with no config", () => {
    expect(applyConfig(diags, null)).toEqual(diags);
  });

  it("drops diagnostics for a rule set to off", () => {
    const c = parseConfig(`{ "rules": { "n-plus-one": "off" } }`, "/p");
    const out = applyConfig(diags, c);
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe("unbounded-read");
  });

  it("overrides severity for a configured rule", () => {
    const c = parseConfig(`{ "rules": { "n-plus-one": "warning" } }`, "/p");
    const out = applyConfig(diags, c);
    expect(out.find((d) => d.ruleId === "n-plus-one")!.severity).toBe("warning");
    // Unconfigured rule keeps its default severity.
    expect(out.find((d) => d.ruleId === "unbounded-read")!.severity).toBe("warning");
  });
});
