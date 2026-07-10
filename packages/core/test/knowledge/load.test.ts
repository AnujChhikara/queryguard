import { describe, it, expect } from "vitest";
import { parseKnowledge, DEFAULT_THRESHOLDS } from "../../src/knowledge/load.js";

describe("parseKnowledge", () => {
  it("parses tables, filters, and applies default thresholds", () => {
    const k = parseKnowledge(
      `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
      "/proj",
    )!;
    expect(k).not.toBeNull();
    expect(k.tables.user.rows).toBe(10000);
    expect(k.tables.user.filters?.[0]).toEqual({ when: { status: "active" }, rows: 10 });
    expect(k.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(k.suppressions).toEqual([]);
    expect(k.baseDir).toBe("/proj");
  });

  it("honors explicit thresholds and suppressions", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
thresholds: { small: 5, large: 500 }
suppressions:
  - rule: n-plus-one
    file: src/x.ts
    fn: run
    anchor: "db.q()"
`,
      "/proj",
    )!;
    expect(k.thresholds).toEqual({ small: 5, large: 500 });
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].rule).toBe("n-plus-one");
  });

  it("returns null on wrong version or malformed yaml", () => {
    expect(parseKnowledge(`version: 2\ntables: {}`, "/p")).toBeNull();
    expect(parseKnowledge(`: : :`, "/p")).toBeNull();
    expect(parseKnowledge(`version: 1`, "/p")).toBeNull(); // missing tables
  });
});
