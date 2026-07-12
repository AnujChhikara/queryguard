import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { discoverKnowledge, discoverConfig } from "@cardinal/core";
import { run } from "../src/run.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

describe("run", () => {
  it("finds n-plus-one in the fixture and reports an error count", async () => {
    const result = await run(["nplus1.ts"], fixtures);
    expect(result.errorCount).toBe(1);
    expect(result.diagnostics[0].ruleId).toBe("n-plus-one");
    expect(result.diagnostics[0].file).toContain("nplus1.ts");
  });

  it("reports zero for clean code", async () => {
    const result = await run(["clean.ts"], fixtures);
    expect(result.errorCount).toBe(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("suppresses over-fetch when a knowledge file marks the read bounded via where", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-cli-"));
    try {
      writeFileSync(
        join(dir, "cardinal.knowledge.yaml"),
        `version: 1\ntables:\n  user:\n    rows: 10000\n    filters:\n      - when: { status: active }\n        rows: 10\n`,
      );
      writeFileSync(join(dir, "a.ts"), `async function r(prisma){ return prisma.user.findMany(); }`);
      const knowledge = discoverKnowledge(dir);
      const { diagnostics } = await run(["a.ts"], dir, { knowledge });
      // over-fetch fires (unfiltered read on large table w/ selective filter)
      expect(diagnostics.some((d) => d.ruleId === "over-fetch")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honors a config file that turns a rule off", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-cfg-"));
    try {
      writeFileSync(join(dir, "cardinal.config.json"), `{ "rules": { "unbounded-read": "off" } }`);
      writeFileSync(join(dir, "a.ts"), `async function r(prisma){ return prisma.user.findMany(); }`);
      const config = discoverConfig(dir);
      const { diagnostics } = await run(["a.ts"], dir, { config });
      expect(diagnostics.some((d) => d.ruleId === "unbounded-read")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
