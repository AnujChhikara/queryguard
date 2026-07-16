import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSchema, loadSchema } from "../../src/schema/discover.js";

const MODEL = "model User {\n  id Int @id\n  name String\n}\n";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cardinal-schema-"));
  mkdirSync(join(root, "prisma"));
  writeFileSync(join(root, "prisma", "schema.prisma"), MODEL);
  mkdirSync(join(root, "src", "deep"), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("discoverSchema", () => {
  it("finds prisma/schema.prisma walking up from a nested dir", () => {
    const s = discoverSchema(join(root, "src", "deep"));
    expect(s).not.toBeNull();
    expect(s!.models.user.fields).toContain("name");
  });

  it("returns null when nothing is found", () => {
    const empty = mkdtempSync(join(tmpdir(), "cardinal-empty-"));
    try {
      expect(discoverSchema(empty)).toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("loadSchema", () => {
  it("loads an explicit path", () => {
    const s = loadSchema(join(root, "prisma", "schema.prisma"));
    expect(s?.orm).toBe("prisma");
  });

  it("returns null for a missing file", () => {
    expect(loadSchema(join(root, "nope.prisma"))).toBeNull();
  });
});
