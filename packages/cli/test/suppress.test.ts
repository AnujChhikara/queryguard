import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKnowledge } from "cardinal-core";
import { suppressCommand } from "../src/suppress.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("suppressCommand", () => {
  it("records a suppression with a supplied reason (non-interactive)", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma, ids){\n  for (const id of ids){ await prisma.user.findUnique({ where: { id } }); }\n}`);
    const res = await suppressCommand("a.ts:2", dir, { reason: "ids are bounded", acceptFact: false }, async () => "");
    expect(res.code).toBe(0);

    const k = parseKnowledge(readFileSync(join(dir, "cardinal.knowledge.yaml"), "utf8"), dir)!;
    expect(k.suppressions).toHaveLength(1);
    expect(k.suppressions[0].rule).toBe("n-plus-one");
    expect(k.suppressions[0].reason).toBe("ids are bounded");
  });

  it("errors (code 1) when no diagnostic is on the line", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma){\n  return prisma.user.findMany({ where: { id: 1 } });\n}`);
    const res = await suppressCommand("a.ts:2", dir, { acceptFact: false }, async () => "");
    expect(res.code).toBe(1);
    expect(res.message).toMatch(/no diagnostic/);
  });

  it("asks for a reason via the injected prompt when none supplied", async () => {
    dir = mkdtempSync(join(tmpdir(), "qg-sup-"));
    writeFileSync(join(dir, "a.ts"), `async function r(prisma, ids){\n  for (const id of ids){ await prisma.user.findUnique({ where: { id } }); }\n}`);
    let asked = "";
    const res = await suppressCommand("a.ts:2", dir, { acceptFact: false }, async (q) => { asked = q; return "typed reason"; });
    expect(asked.toLowerCase()).toContain("why");
    expect(res.code).toBe(0);
    const k = parseKnowledge(readFileSync(join(dir, "cardinal.knowledge.yaml"), "utf8"), dir)!;
    expect(k.suppressions[0].reason).toBe("typed reason");
  });
});
