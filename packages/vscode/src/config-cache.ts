import { discoverConfig, type CardinalConfig } from "@cardinal/core";

/**
 * Caches config-file discovery by directory, mirroring KnowledgeCache. Keeps the
 * upward filesystem walk off the on-type hot path; cleared when a config file
 * changes on disk.
 */
export class ConfigCache {
  private readonly cache = new Map<string, CardinalConfig | null>();

  get(dir: string): CardinalConfig | null {
    const hit = this.cache.get(dir);
    if (hit !== undefined) return hit;
    const config = discoverConfig(dir);
    this.cache.set(dir, config);
    return config;
  }

  clear(): void {
    this.cache.clear();
  }
}
