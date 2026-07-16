import type { ModelSchema, SchemaInfo } from "./types.js";

/** `UserProfile` → `userProfile` — the Prisma client property for a model. */
function clientName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** `"orgId, slug(sort: Desc)"` → `["orgId", "slug"]`. */
function parseFieldList(inner: string): string[] {
  return inner
    .split(",")
    .map((part) => part.trim().split(/[(\s]/, 1)[0])
    .filter((name) => name.length > 0);
}

const MODEL_OPEN = /^\s*model\s+([A-Za-z_]\w*)\s*\{/;
const BLOCK_ATTR = /^\s*@@(?:id|unique|index)\s*\(\s*\[([^\]]*)\]/;
const FIELD_LINE = /^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(?:\[\])?\??/;

/**
 * Line-based parser for schema.prisma — deliberately dependency-free. It only
 * needs field names and index column lists, not the full PSL grammar.
 */
export function parsePrismaSchema(text: string, filePath: string): SchemaInfo | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ""));

  // Pass 1: model names, so relation fields (typed as another model) can be
  // told apart from scalar/enum columns.
  const modelNames = new Set<string>();
  for (const line of lines) {
    const m = MODEL_OPEN.exec(line);
    if (m) modelNames.add(m[1]);
  }
  if (modelNames.size === 0) return null;

  const models: Record<string, ModelSchema> = {};
  let current: { name: string; schema: ModelSchema } | null = null;
  for (const line of lines) {
    if (!current) {
      const m = MODEL_OPEN.exec(line);
      if (m) current = { name: m[1], schema: { fields: [], indexes: [] } };
      continue;
    }
    if (/^\s*\}/.test(line)) {
      models[clientName(current.name)] = current.schema;
      current = null;
      continue;
    }
    const block = BLOCK_ATTR.exec(line);
    if (block) {
      const fields = parseFieldList(block[1]);
      if (fields.length > 0) current.schema.indexes.push(fields);
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (!field) continue;
    const [, name, baseType] = field;
    if (modelNames.has(baseType)) continue; // relation, not a queryable column
    current.schema.fields.push(name);
    if (/@id\b/.test(line) || /@unique\b/.test(line)) current.schema.indexes.push([name]);
  }
  return { orm: "prisma", filePath, models };
}
