import { describe, it, expect } from "vitest";
import { parsePrismaSchema } from "../../src/schema/prisma.js";

const SCHEMA = `
datasource db { provider = "postgresql" }

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String
  createdAt DateTime @default(now())
  posts     Post[]
}

model Post {
  id       Int    @id
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
  orgId    Int
  slug     String

  @@index([orgId, slug])
  @@unique([authorId, slug], map: "author_slug")
}
`;

describe("parsePrismaSchema", () => {
  it("keys models by client name and collects scalar fields", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s).not.toBeNull();
    expect(Object.keys(s!.models).sort()).toEqual(["post", "user"]);
    expect(s!.models.user.fields).toEqual(["id", "email", "name", "createdAt"]);
  });

  it("excludes relation fields from fields", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s!.models.post.fields).not.toContain("author");
    expect(s!.models.user.fields).not.toContain("posts");
  });

  it("collects @id/@unique and @@index/@@unique with column order", () => {
    const s = parsePrismaSchema(SCHEMA, "/p/schema.prisma");
    expect(s!.models.user.indexes).toContainEqual(["id"]);
    expect(s!.models.user.indexes).toContainEqual(["email"]);
    expect(s!.models.post.indexes).toContainEqual(["orgId", "slug"]);
    expect(s!.models.post.indexes).toContainEqual(["authorId", "slug"]);
  });

  it("handles sort annotations in index field lists", () => {
    const s = parsePrismaSchema(
      "model A {\n  id Int @id\n  ts DateTime\n  @@index([ts(sort: Desc)])\n}",
      "/p/s",
    );
    expect(s!.models.a.indexes).toContainEqual(["ts"]);
  });

  it("returns null for text with no models", () => {
    expect(parsePrismaSchema("SELECT 1;", "/p/x")).toBeNull();
  });

  it("ignores commented-out lines", () => {
    const s = parsePrismaSchema(
      "model A {\n  id Int @id\n  // ghost String @unique\n}",
      "/p/s",
    );
    expect(s!.models.a.fields).toEqual(["id"]);
    expect(s!.models.a.indexes).toEqual([["id"]]);
  });
});
