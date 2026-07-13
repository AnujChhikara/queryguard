import { describe, it, expect } from "vitest";
import { analyzeSource } from "../src/engine.js";

// Patterns that LOOK like anti-patterns but aren't — the false-positive corpus.
// Each must produce zero diagnostics. Grow this whenever a real FP is found.
const clean: Record<string, string> = {
  "Array.find with callback": `async function r(items){ return items.find((x) => x.id === 1); }`,
  "Array.map transform": `async function r(users){ return users.map((u) => u.name); }`,
  "Array.forEach": `async function r(items){ items.forEach((x) => console.log(x)); }`,
  "Array.filter in loop": `async function r(rows){ for (const g of rows){ rows.filter((x) => x.g === g); } }`,
  "Promise.all over non-query": `async function r(items){ await Promise.all(items.map(async (i) => process(i))); }`,
  "Map.get in a loop": `async function r(cache, ids){ for (const id of ids){ await cache.get(id); } }`,
  "Redux store.dispatch in a loop": `async function r(store, actions){ for (const a of actions){ await store.dispatch(a); } }`,
  "entity-manager flush in a loop": `async function r(em, xs){ for (const x of xs){ await em.flush(); } }`,
  "logger.getLevel in a loop": `async function r(logger, xs){ for (const x of xs){ await logger.getLevel(); } }`,
  "config store.get in a loop": `async function r(store, keys){ for (const k of keys){ await store.get(k); } }`,
  "prisma findFirst (single row, implicit LIMIT 1)": `async function r(){ return prisma.user.findFirst(); }`,
  "prisma findFirstOrThrow (single row)": `async function r(){ return prisma.user.findFirstOrThrow(); }`,
  "mongoose findOne (single row)": `async function r(){ return User.findOne(); }`,
  "drizzle findFirst (single row)": `async function r(db){ return db.query.users.findFirst(); }`,
  "raw SELECT with no table (health check)": "async function r(db){ return db.query(`SELECT 1`); }",
  "raw SELECT NOW() (no table)": "async function r(db){ return db.query(`SELECT NOW()`); }",
  "prisma create in a loop (write, not N+1)": `async function r(items){ for (const i of items){ await prisma.user.create({ data: i }); } }`,
  "prisma update in a transaction loop (write)": `async function r(tx, items){ for (const i of items){ await tx.audit.update({ where: { id: i.id }, data: i }); } }`,
  "mongoose save in a loop (write)": `async function r(docs){ for (const d of docs){ await d.save(); } }`,
  "playwright locator .count() in a loop": `async function r(locators){ for (const loc of locators){ await loc.count(); } }`,
  "API client .list() in a loop": `async function r(client, pages){ for (const p of pages){ await client.events.list(p); } }`,
  "mail fixture .search() in a loop": `async function r(emails, users){ for (const u of users){ await emails.search(u.email); } }`,
  "prisma findMany with opaque args (filter passed as variable)": `async function r(args){ return prisma.user.findMany(args); }`,
  "retry loop around a query (for attempt <= maxRetries)": `async function r(client, q){ for (let attempt = 1; attempt <= 3; attempt++){ await client.query(q); } }`,
  "while-poll loop acquiring a lock": `async function r(db){ let locked = false; while (!locked){ locked = await db.query.locks.findFirst(); } }`,
  "capitalized non-model .find with opaque arg (Memory.find)": `async function r(fn, ptr){ return Memory.find(fn(ptr)); }`,
  "GraphQL client .query(document) in a loop": `async function r(client, docs){ for (const d of docs){ await client.query(d, {}); } }`,
  "typeorm repo.save in a loop (write, not N+1)": `async function r(userRepository, items){ for (const i of items){ await userRepository.save(i); } }`,
  "typeorm QueryBuilder getOne (single row)": `async function r(repo){ return repo.createQueryBuilder("u").getOne(); }`,
};

describe("false-positive corpus (must stay clean)", () => {
  for (const [name, code] of Object.entries(clean)) {
    it(name, () => {
      expect(analyzeSource(code)).toEqual([]);
    });
  }
});

describe("true positives still fire (no over-correction)", () => {
  it("flags a no-ORM data-access call in a loop (data-source receiver + query verb)", () => {
    const diags = analyzeSource(
      `async function r(dataAccess, ids){ for (const id of ids){ await dataAccess.retrieveUsers({ id }); } }`,
    );
    expect(diags.some((d) => d.ruleId === "n-plus-one")).toBe(true);
  });

  it("flags a db-receiver weak verb in a loop", () => {
    const diags = analyzeSource(`async function r(db, ids){ for (const id of ids){ await db.getUser(id); } }`);
    expect(diags.some((d) => d.ruleId === "n-plus-one")).toBe(true);
  });

  it("still flags a findBy* repository call in a loop (strong verb, any receiver)", () => {
    const diags = analyzeSource(`async function r(svc, emails){ for (const e of emails){ await svc.findByEmail(e); } }`);
    expect(diags.some((d) => d.ruleId === "n-plus-one")).toBe(true);
  });

  it("still warns on an unfiltered mongoose find() (returns many)", () => {
    const diags = analyzeSource(`async function r(){ return User.find(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("flags a typeorm repo.find in a loop as an N+1 error", () => {
    const diags = analyzeSource(`async function r(userRepository, ids){ for (const id of ids){ await userRepository.find({ where: { id } }); } }`);
    expect(diags.some((d) => d.ruleId === "n-plus-one" && d.severity === "error")).toBe(true);
  });

  it("warns on an unfiltered typeorm repo.find()", () => {
    const diags = analyzeSource(`async function r(userRepository){ return userRepository.find(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("still lets Mongoose handle Model.find() (TypeORM adapter doesn't steal it)", () => {
    const diags = analyzeSource(`async function r(){ return User.find(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("still warns on prisma findMany() with no arguments at all (genuinely unbounded)", () => {
    const diags = analyzeSource(`async function r(){ return prisma.user.findMany(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("still warns on a raw SELECT scanning a real table", () => {
    const diags = analyzeSource("async function r(db){ return db.query(`SELECT * FROM users`); }");
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });
});
