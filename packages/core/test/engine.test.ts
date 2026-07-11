import { describe, it, expect } from "vitest";
import { analyzeSource } from "../src/engine.js";
import { parseKnowledge } from "../src/knowledge/load.js";

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
        // queryguard: bounded
        for (const x of xs) { await prisma.post.findMany({ where: { authorId: x.id } }); }
      }`,
      undefined,
      knowledge,
    );
    expect(diags.filter((d) => d.ruleId === "n-plus-one")).toHaveLength(0);
  });
});
