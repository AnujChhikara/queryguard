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
});
