import { discoverSchema, type SchemaInfo } from "cardinal-core";

/**
 * Caches schema-file discovery by directory, mirroring KnowledgeCache — the
 * upward filesystem walk is too costly for the on-type hot path. Misses are
 * memoized as null until clear() (e.g. when a schema.prisma changes on disk).
 */
export class SchemaCache {
  private readonly cache = new Map<string, SchemaInfo | null>();

  get(dir: string): SchemaInfo | null {
    const hit = this.cache.get(dir);
    if (hit !== undefined) return hit;
    const schema = discoverSchema(dir);
    this.cache.set(dir, schema);
    return schema;
  }

  clear(): void {
    this.cache.clear();
  }
}
