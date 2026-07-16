/** Index/field facts for one model, extracted from an ORM schema file. */
export interface ModelSchema {
  /** Scalar/enum field names — the queryable columns. Relation fields are excluded. */
  fields: string[];
  /**
   * Each declared index as its ordered column list; [0] is the leading column.
   * Includes @id, @unique, @@id, @@unique and @@index declarations.
   */
  indexes: string[][];
}

export interface SchemaInfo {
  /** Which adapter's descriptors this schema describes (matches QueryDescriptor.orm). */
  orm: string;
  /** Absolute path of the schema file — used in diagnostics. */
  filePath: string;
  /** Keyed by the client-side model name (`prisma.user` → "user"). */
  models: Record<string, ModelSchema>;
}
