import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KnowledgeCache } from "../src/knowledge-cache.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("KnowledgeCache", () => {
  it("discovers a knowledge file by directory", () => {
    dir = mkdtempSync(join(tmpdir(), "qg-kc-"));
    writeFileSync(join(dir, "queryguard.knowledge.yaml"), `version: 1\ntables:\n  user:\n    rows: 42\n`);
    const cache = new KnowledgeCache();
    const k = cache.get(dir);
    expect(k?.tables.user.rows).toBe(42);
  });

  it("returns null (and caches it) when no knowledge file exists", () => {
    dir = mkdtempSync(join(tmpdir(), "qg-kc-"));
    const cache = new KnowledgeCache();
    expect(cache.get(dir)).toBeNull();
    // Writing a file after the miss is cached should not change the result until clear().
    writeFileSync(join(dir, "queryguard.knowledge.yaml"), `version: 1\ntables: {}\n`);
    expect(cache.get(dir)).toBeNull();
  });

  it("re-discovers after clear()", () => {
    dir = mkdtempSync(join(tmpdir(), "qg-kc-"));
    const cache = new KnowledgeCache();
    expect(cache.get(dir)).toBeNull();
    writeFileSync(join(dir, "queryguard.knowledge.yaml"), `version: 1\ntables:\n  user:\n    rows: 7\n`);
    cache.clear();
    expect(cache.get(dir)?.tables.user.rows).toBe(7);
  });
});
