import { describe, it, expect } from "vitest";
import { analyzeSource } from "../src/engine.js";
import { parseKnowledge } from "../src/knowledge/load.js";
import { parseConfig } from "../src/config.js";

describe("analyzeSource", () => {
  it("reports n-plus-one for a prisma query in a loop", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        const users = [];
        for (const id of ids) {
          users.push(await prisma.user.findUnique({ where: { id } }));
        }
        return users;
      }
    `);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
  });

  it("reports nothing for a batched query", () => {
    const diags = analyzeSource(`
      async function loadUsers(prisma, ids) {
        return prisma.user.findMany({ where: { id: { in: ids } } });
      }
    `);
    expect(diags).toHaveLength(0);
  });

  it("does not throw on unparsable input", () => {
    expect(() => analyzeSource("const x = ")).not.toThrow();
  });

  it("warns unbounded-read on a filterless, limitless prisma read", () => {
    const diags = analyzeSource(`async function all(prisma){ return prisma.user.findMany(); }`);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("unbounded-read");
    expect(diags[0].severity).toBe("warning");
  });

  it("warns on a no-ORM query in a loop (heuristic)", () => {
    const diags = analyzeSource(`
      async function getAll(items) {
        await Promise.all(items.map(async (i) => {
          const u = await dataAccess.retrieveUsers({ id: i.id });
          return u;
        }));
      }
    `);
    expect(diags).toHaveLength(1);
    expect(diags[0].ruleId).toBe("n-plus-one");
    expect(diags[0].severity).toBe("warning");
  });
});

describe("analyzeSource across adapters", () => {
  it("flags an unbounded-read on a Drizzle relational read", () => {
    const diags = analyzeSource(`async function r(db){ return db.query.users.findMany(); }`);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("flags n-plus-one (error) for a Mongoose query in a loop", () => {
    const diags = analyzeSource(
      `async function r(ids){ for (const id of ids){ await User.findById(id); } }`,
    );
    const np = diags.filter((d) => d.ruleId === "n-plus-one");
    expect(np).toHaveLength(1);
    expect(np[0].severity).toBe("error");
  });

  it("flags n-plus-one (error) for a raw-SQL query in a loop", () => {
    const diags = analyzeSource(
      "async function r(sql, ids){ for (const id of ids){ await sql`SELECT * FROM posts WHERE authorId = ${id}`; } }",
    );
    const np = diags.filter((d) => d.ruleId === "n-plus-one");
    expect(np).toHaveLength(1);
    expect(np[0].severity).toBe("error");
  });

  it("flags an unbounded-read on a raw-SQL SELECT without WHERE/LIMIT", () => {
    const diags = analyzeSource("async function r(sql){ await sql`SELECT * FROM users`; }");
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(true);
  });

  it("does not double-report a Drizzle-style db.execute(sql``) query", () => {
    const diags = analyzeSource("async function r(db){ await db.execute(sql`SELECT * FROM users`); }");
    expect(diags.filter((d) => d.ruleId === "unbounded-read")).toHaveLength(1);
  });

  it("flags order-by-rand and leading-wildcard-like in raw SQL", () => {
    const rand = analyzeSource("async function r(sql){ await sql`SELECT * FROM users ORDER BY RAND() LIMIT 1`; }");
    expect(rand.some((d) => d.ruleId === "order-by-rand")).toBe(true);
    const like = analyzeSource("async function r(sql){ await sql`SELECT id FROM users WHERE email LIKE '%@x.com'`; }");
    expect(like.some((d) => d.ruleId === "leading-wildcard-like")).toBe(true);
  });

  it("flags excessive-joins via the SQL parser", () => {
    const diags = analyzeSource(
      "async function r(sql){ await sql`SELECT * FROM a JOIN b ON a.id=b.a JOIN c ON b.id=c.b JOIN d ON c.id=d.c JOIN e ON d.id=e.d JOIN f ON e.id=f.e`; }",
    );
    expect(diags.some((d) => d.ruleId === "excessive-joins")).toBe(true);
  });
});

describe("analyzeSource with config", () => {
  const code = `async function all(prisma){ return prisma.user.findMany(); }`;

  it("drops a rule set to off", () => {
    const config = parseConfig(`{ "rules": { "unbounded-read": "off" } }`, "/p");
    const diags = analyzeSource(code, undefined, null, config);
    expect(diags.some((d) => d.ruleId === "unbounded-read")).toBe(false);
  });

  it("overrides severity", () => {
    const config = parseConfig(`{ "rules": { "unbounded-read": "error" } }`, "/p");
    const diags = analyzeSource(code, undefined, null, config);
    const d = diags.find((x) => x.ruleId === "unbounded-read")!;
    expect(d.severity).toBe("error");
  });

  it("is byte-identical to no-config when config is null", () => {
    expect(analyzeSource(code, undefined, null, null)).toEqual(analyzeSource(code));
  });
});

describe("knowledge-aware silencing across adapters", () => {
  const knowledge = parseKnowledge(
    `version: 1
tables:
  users:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
  User:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
    "/p",
  );

  it("silences n-plus-one for a Drizzle loop over a provably-small set", () => {
    const diags = analyzeSource(
      `async function r(db){
        const active = await db.query.users.findMany({ where: eq(users.status, "active") });
        for (const u of active) { await db.query.posts.findMany({ where: eq(posts.authorId, u.id) }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });

  it("silences n-plus-one for a Mongoose loop over a provably-small set", () => {
    const diags = analyzeSource(
      `async function r(){
        const active = await User.find({ status: "active" });
        for (const u of active) { await Post.findOne({ author: u.id }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });

  it("silences n-plus-one for a raw-SQL loop over a provably-small set", () => {
    const diags = analyzeSource(
      "async function r(sql){\n" +
        "  const active = await sql`SELECT * FROM users WHERE status = 'active'`;\n" +
        "  for (const u of active) { await sql`SELECT id FROM posts WHERE author_id = ${u.id}`; }\n" +
        "}",
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });

  it("still flags n-plus-one for those loops with no knowledge file", () => {
    const diags = analyzeSource(
      `async function r(db){
        const active = await db.query.users.findMany({ where: eq(users.status, "active") });
        for (const u of active) { await db.query.posts.findMany({ where: eq(posts.authorId, u.id) }); }
      }`,
    );
    expect(diags.some((d) => d.ruleId === "n-plus-one")).toBe(true);
  });
});

describe("analyzeSource with knowledge", () => {
  const knowledge = parseKnowledge(
    `version: 1
tables:
  user:
    rows: 10000
    filters:
      - when: { status: active }
        rows: 10
`,
    "/p",
  );

  it("suppresses n-plus-one when the driving set is provably small", () => {
    const diags = analyzeSource(
      `async function r(prisma){
        const active = await prisma.user.findMany({ where: { status: "active" } });
        for (const u of active) { await prisma.post.findMany({ where: { authorId: u.id } }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });

  it("honors an inline bounded hint even without a traceable producer", () => {
    const diags = analyzeSource(
      `async function r(prisma, xs){
        // cardinal: bounded
        for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });
});
