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

  it("still warns on prisma findMany() with no arguments at all (genuinely unbounded)", () => {
    const diags = analyzeSource(`async function r(){ return prisma.user.findMany(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("still warns on a raw SELECT scanning a real table", () => {
    const diags = analyzeSource("async function r(db){ return db.query(`SELECT * FROM users`); }");
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });
});
