import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigCache } from "../src/config-cache.js";

let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("ConfigCache", () => {
  it("discovers a config file by directory", () => {
    dir = mkdtempSync(join(tmpdir(), "cardinal-cfg-"));
    writeFileSync(join(dir, "cardinal.config.json"), `{ "rules": { "over-fetch": "off" } }`);
    const cache = new ConfigCache();
    expect(cache.get(dir)?.rules["over-fetch"]).toBe("off");
  });

  it("caches a miss and re-discovers after clear()", () => {
    dir = mkdtempSync(join(tmpdir(), "cardinal-cfg-"));
    const cache = new ConfigCache();
    expect(cache.get(dir)).toBeNull();
    writeFileSync(join(dir, "cardinal.config.json"), `{ "rules": { "n-plus-one": "warning" } }`);
    expect(cache.get(dir)).toBeNull(); // still cached miss
    cache.clear();
    expect(cache.get(dir)?.rules["n-plus-one"]).toBe("warning");
  });
});
