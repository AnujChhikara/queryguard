import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { buildSuppressPlan, addSuppression, addFact } from "../../src/knowledge/store.js";
import { parseKnowledge } from "../../src/knowledge/load.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("buildSuppressPlan", () => {
  it("locates the diagnostic on a line and produces a suppression + suggested fact", () => {
    const knowledge = parseKnowledge(`version: 1\ntables:\n  user:\n    rows: 10000\n`, "/p")!;
    const code = `async function r(prisma){\n  return prisma.user.findMany();\n}`;
    const plan = buildSuppressPlan(code, "src/x.ts", 2, undefined, knowledge);
    expect("error" in plan).toBe(false);
    const p = plan as Extract<typeof plan, { suppression: unknown }>;
    // The unfiltered read on a table with no filter facts triggers unbounded-read.
    expect(p.suppression.rule).toBe("unbounded-read");
    expect(p.suppression.fn).toBe("r");
    expect(p.suppression.anchor).toBe("prisma.user.findMany()");
    // Cardinality here is a table-source (not a small filter), so no fact is suggested.
    expect(p.suggestedFact).toBeUndefined();
  });

  it("errors when no diagnostic covers the line", () => {
    const code = `async function r(prisma){\n  return prisma.user.findMany({ where: { id: 1 } });\n}`;
    const plan = buildSuppressPlan(code, "src/x.ts", 2, undefined, null);
    expect("error" in plan).toBe(true);
  });
});

describe("addSuppression / addFact", () => {
  it("appends a suppression to a new file and a fact to an existing table", () => {
    dir = mkdtempSync(join(tmpdir(), "qg-"));
    const file = join(dir, "cardinal.knowledge.yaml");

    addSuppression(file, { rule: "n-plus-one", file: "src/x.ts", fn: "r", anchor: "db.q()", reason: "bounded", added: "2026-07-10" });
    let k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].reason).toBe("bounded");

    addFact(file, "contact", 10);
    k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.tables.contact.rows).toBe(10);
    // Suppression survives the fact write.
    expect(k.suppressions).toHaveLength(1);
  });
});
