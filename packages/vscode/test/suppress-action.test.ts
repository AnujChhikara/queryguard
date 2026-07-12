import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKnowledge } from "cardinal-core";
import { performSuppression } from "../src/suppress-action.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const NPLUS1 = `async function r(prisma, ids){\n  for (const id of ids){ await prisma.user.findUnique({ where: { id } }); }\n}`;

function setup(code = NPLUS1): { abs: string } {
  dir = mkdtempSync(join(tmpdir(), "cardinal-qf-"));
  const abs = join(dir, "svc.ts");
  writeFileSync(abs, code);
  return { abs };
}

const yes: () => Promise<boolean> = async () => true;
const no: () => Promise<boolean> = async () => false;

describe("performSuppression", () => {
  it("records a suppression with a reason into a new knowledge file", async () => {
    const { abs } = setup();
    const res = await performSuppression(
      { code: NPLUS1, absPath: abs, relPath: "svc.ts", line: 2, ruleId: "n-plus-one", workspaceRoot: dir },
      { askReason: async () => "ids are bounded", confirmFact: no },
    );
    expect(res.ok).toBe(true);

    const file = join(dir, "cardinal.knowledge.yaml");
    const k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].rule).toBe("n-plus-one");
    expect(k.suppressions[0].reason).toBe("ids are bounded");
  });

  it("aborts without writing when the reason is cancelled", async () => {
    const { abs } = setup();
    const res = await performSuppression(
      { code: NPLUS1, absPath: abs, relPath: "svc.ts", line: 2, ruleId: "n-plus-one", workspaceRoot: dir },
      { askReason: async () => undefined, confirmFact: yes },
    );
    expect(res.ok).toBe(false);
    expect(existsSync(join(dir, "cardinal.knowledge.yaml"))).toBe(false);
  });

  it("returns an error when no diagnostic matches the line/rule", async () => {
    const clean = `async function r(prisma){\n  return prisma.user.findMany({ where: { id: 1 } });\n}`;
    const { abs } = setup(clean);
    const res = await performSuppression(
      { code: clean, absPath: abs, relPath: "svc.ts", line: 2, ruleId: "n-plus-one", workspaceRoot: dir },
      { askReason: async () => "x", confirmFact: no },
    );
    expect(res.ok).toBe(false);
    expect(existsSync(join(dir, "cardinal.knowledge.yaml"))).toBe(false);
  });

  it("records an implied fact when confirmFact returns true", async () => {
    // An n+1 whose inner query is itself a known small filtered set → suggested fact.
    dir = mkdtempSync(join(tmpdir(), "cardinal-qf-"));
    const abs = join(dir, "svc.ts");
    const code = `async function r(prisma, xs){\n  for (const x of xs){ await prisma.user.findMany({ where: { status: "active" } }); }\n}`;
    writeFileSync(abs, code);
    writeFileSync(
      join(dir, "cardinal.knowledge.yaml"),
      `version: 1\ntables:\n  user:\n    rows: 10000\n    filters:\n      - when: { status: active }\n        rows: 10\n`,
    );
    const res = await performSuppression(
      { code, absPath: abs, relPath: "svc.ts", line: 2, ruleId: "n-plus-one", workspaceRoot: dir },
      { askReason: async () => "curated", confirmFact: yes },
    );
    expect(res.ok).toBe(true);
    const k = parseKnowledge(readFileSync(join(dir, "cardinal.knowledge.yaml"), "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.tables.user.rows).toBe(10);
  });

  it("reuses an existing discovered knowledge file instead of creating one", async () => {
    const { abs } = setup();
    const existing = join(dir, "cardinal.knowledge.yaml");
    writeFileSync(existing, `version: 1\ntables:\n  post:\n    rows: 5\n`);
    const res = await performSuppression(
      { code: NPLUS1, absPath: abs, relPath: "svc.ts", line: 2, ruleId: "n-plus-one", workspaceRoot: dir },
      { askReason: async () => "", confirmFact: no },
    );
    expect(res.ok).toBe(true);
    const k = parseKnowledge(readFileSync(existing, "utf8"), dir)!;
    // The pre-existing table fact survives, and the suppression is appended.
    expect(k.tables.post.rows).toBe(5);
    expect(k.suppressions).toHaveLength(1);
  });
});
