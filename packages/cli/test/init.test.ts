import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseKnowledge } from "cardinal-core";
import { initCommand } from "../src/init.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("initCommand", () => {
  it("scaffolds a knowledge file from the codebase", async () => {
    dir = mkdtempSync(join(tmpdir(), "cardinal-init-"));
    writeFileSync(
      join(dir, "a.ts"),
      `async function r(prisma){ return prisma.user.findMany({ where: { status: "active" } }); }`,
    );
    const res = await initCommand([], dir, {});
    expect(res.code).toBe(0);

    const file = join(dir, "cardinal.knowledge.yaml");
    expect(existsSync(file)).toBe(true);
    const k = parseKnowledge(readFileSync(file, "utf8"), dir)!;
    expect(k.tables.user).toBeDefined();
    expect((k.tables.user.filters ?? [])[0].when).toEqual({ status: "active" });
  });

  it("refuses to overwrite an existing knowledge file without --force", async () => {
    dir = mkdtempSync(join(tmpdir(), "cardinal-init-"));
    writeFileSync(join(dir, "cardinal.knowledge.yaml"), "version: 1\ntables: {}\n");
    writeFileSync(join(dir, "a.ts"), `async function r(prisma){ return prisma.user.findMany(); }`);
    const res = await initCommand([], dir, {});
    expect(res.code).toBe(1);
    expect(res.message).toMatch(/already exists/);
    // untouched
    expect(readFileSync(join(dir, "cardinal.knowledge.yaml"), "utf8")).toContain("tables: {}");
  });

  it("overwrites with --force", async () => {
    dir = mkdtempSync(join(tmpdir(), "cardinal-init-"));
    writeFileSync(join(dir, "cardinal.knowledge.yaml"), "version: 1\ntables: {}\n");
    writeFileSync(join(dir, "a.ts"), `async function r(prisma){ return prisma.user.findMany(); }`);
    const res = await initCommand([], dir, { force: true });
    expect(res.code).toBe(0);
    expect(parseKnowledge(readFileSync(join(dir, "cardinal.knowledge.yaml"), "utf8"), dir)!.tables.user).toBeDefined();
  });
});
