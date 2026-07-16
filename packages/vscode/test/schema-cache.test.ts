import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchemaCache } from "../src/schema-cache.js";

describe("SchemaCache", () => {
  it("discovers and caches a schema; clear() re-reads", () => {
    const root = mkdtempSync(join(tmpdir(), "cardinal-vsc-schema-"));
    try {
      mkdirSync(join(root, "prisma"));
      writeFileSync(join(root, "prisma", "schema.prisma"), "model User {\n  id Int @id\n}\n");
      const cache = new SchemaCache();
      expect(cache.get(root)?.models.user).toBeTruthy();
      // Remove the file: the cached hit must survive until clear().
      rmSync(join(root, "prisma", "schema.prisma"));
      expect(cache.get(root)?.models.user).toBeTruthy();
      cache.clear();
      expect(cache.get(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
