import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
});
