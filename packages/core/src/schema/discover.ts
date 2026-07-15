import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse as parsePath } from "node:path";
import { parsePrismaSchema } from "./prisma.js";
import type { SchemaInfo } from "./types.js";

const CANDIDATES = ["prisma/schema.prisma", "schema.prisma"];

export function loadSchema(filePath: string): SchemaInfo | null {
  if (!existsSync(filePath)) return null;
  try {
    return parsePrismaSchema(readFileSync(filePath, "utf8"), filePath);
  } catch {
    return null;
  }
}

/** Walks up from `fromDir` looking for a Prisma schema, like discoverKnowledge. */
export function discoverSchema(fromDir: string): SchemaInfo | null {
  let dir = fromDir;
  while (true) {
    for (const rel of CANDIDATES) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return loadSchema(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir || parsePath(dir).root === dir) return null;
    dir = parent;
  }
}
