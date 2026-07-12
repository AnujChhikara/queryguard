import { discoverKnowledge, type Knowledge } from "@queryguard/core";

/**
 * Caches knowledge-file discovery by directory. `discoverKnowledge` walks the
 * filesystem upward on every call, which is too costly to run on each keystroke
 * of an on-type analyzer — so results (including misses, stored as `null`) are
 * memoized until `clear()` is called (e.g. when the knowledge file changes).
 */
export class KnowledgeCache {
  private readonly cache = new Map<string, Knowledge | null>();

  get(dir: string): Knowledge | null {
    const hit = this.cache.get(dir);
    if (hit !== undefined) return hit;
    const knowledge = discoverKnowledge(dir);
    this.cache.set(dir, knowledge);
    return knowledge;
  }

  clear(): void {
    this.cache.clear();
  }
}
