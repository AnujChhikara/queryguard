import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { drizzleAdapter } from "../../src/adapters/drizzle.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("drizzleAdapter", () => {
  it("recognizes a relational findMany read and fills the descriptor", () => {
    const call = firstCall(
      `async function r(db){ await db.query.users.findMany({ where: eq(users.id, 1), limit: 10 }); }`,
      "db.query.users.findMany",
    );
    const d = drizzleAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.orm).toBe("drizzle");
    expect(d!.operation).toBe("read");
    expect(d!.target).toBe("users");
    expect(d!.confidence).toBe("high");
    expect(d!.hasFilter).toBe(true);
    expect(d!.hasLimit).toBe(true);
    expect(d!.isAggregate).toBe(false);
    expect(d!.awaited).toBe(true);
  });

  it("recognizes findFirst and reports no filter / no limit when absent", () => {
    const call = firstCall(
      `async function r(db){ return db.query.posts.findFirst(); }`,
      "db.query.posts.findFirst",
    );
    const d = drizzleAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.target).toBe("posts");
    expect(d!.hasFilter).toBe(false);
    expect(d!.hasLimit).toBe(false);
  });

  it("marks a query inside a loop", () => {
    const call = firstCall(
      `async function r(db, ids){ for (const id of ids){ await db.query.users.findFirst({ where: eq(users.id, id) }); } }`,
      "db.query.users.findFirst",
    );
    expect(drizzleAdapter(call)!.inLoop).toBe(true);
  });

  it("does NOT match the chained query builder (deferred)", () => {
    const call = firstCall(
      `async function r(db){ return db.select().from(users).where(eq(users.id, 1)); }`,
      "db.select().from(users).where",
    );
    expect(drizzleAdapter(call)).toBeNull();
  });

  it("does not match an unrelated property-access call", () => {
    const call = firstCall(`async function r(db){ await db.user.findMany(); }`, "db.user.findMany");
    expect(drizzleAdapter(call)).toBeNull();
  });

  it("extracts an eq() predicate from where", () => {
    const call = firstCall(
      `async function r(db){ await db.query.users.findMany({ where: eq(users.status, "active") }); }`,
      "db.query.users.findMany",
    );
    expect(drizzleAdapter(call)!.filters).toEqual([{ field: "status", value: "active", kind: "eq" }]);
  });

  it("flattens and() and marks inArray() as 'in'", () => {
    const call = firstCall(
      `async function r(db, ids){ await db.query.users.findMany({ where: and(eq(users.status, "active"), inArray(users.id, ids)) }); }`,
      "db.query.users.findMany",
    );
    expect(drizzleAdapter(call)!.filters).toEqual([
      { field: "status", value: "active", kind: "eq" },
      { field: "id", kind: "in" },
    ]);
  });

  it("treats a non-literal eq value as unknown, and gt()/or() as 'other'", () => {
    const nonLit = firstCall(
      `async function r(db, s){ await db.query.users.findMany({ where: eq(users.status, s) }); }`,
      "db.query.users.findMany",
    );
    expect(drizzleAdapter(nonLit)!.filters).toEqual([{ field: "status", kind: "eq" }]);
    const gt = firstCall(
      `async function r(db){ await db.query.users.findMany({ where: gt(users.age, 5) }); }`,
      "db.query.users.findMany",
    );
    expect(drizzleAdapter(gt)!.filters).toEqual([{ field: "age", kind: "other" }]);
  });

  it("leaves filters empty when there is no where", () => {
    const call = firstCall(`async function r(db){ return db.query.users.findMany(); }`, "db.query.users.findMany");
    expect(drizzleAdapter(call)!.filters).toEqual([]);
  });
});
