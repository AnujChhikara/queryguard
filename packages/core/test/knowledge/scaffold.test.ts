import { describe, it, expect } from "vitest";
import { collectQueries } from "../../src/engine.js";
import { buildKnowledgeScaffold } from "../../src/knowledge/scaffold.js";
import { parseKnowledge } from "../../src/knowledge/load.js";

const descriptors = collectQueries(`
  async function a(prisma){ await prisma.user.findMany({ where: { status: "active" } }); }
  async function a2(prisma){ await prisma.user.findMany({ where: { status: "active" } }); }
  async function b(prisma){ await prisma.user.findMany({ where: { id: 5 } }); }
  async function c(){ await Contact.find({ archived: false }); }
  async function d(sql){ await sql\`SELECT * FROM orders\`; }
`);
const yaml = buildKnowledgeScaffold(descriptors);

describe("buildKnowledgeScaffold", () => {
  it("lists every non-heuristic table", () => {
    const k = parseKnowledge(yaml, "/p")!;
    expect(Object.keys(k.tables).sort()).toEqual(["Contact", "orders", "user"]);
  });

  it("scaffolds candidate eq-filters from the code, excluding id-like fields", () => {
    const k = parseKnowledge(yaml, "/p")!;
    const userFilters = (k.tables.user.filters ?? []).map((f) => Object.keys(f.when)[0]);
    expect(userFilters).toEqual(["status"]); // id excluded
    expect(yaml).toContain("when: { status: active }");
    expect(yaml).toContain("when: { archived: false }");
  });

  it("annotates how many times each filter was seen", () => {
    expect(yaml).toMatch(/when: \{ status: active \}\s+# seen 2×/);
  });

  it("uses per-ORM count hints", () => {
    expect(yaml).toContain("SELECT count(*) FROM user WHERE status = 'active';");
    expect(yaml).toContain("db.Contact.countDocuments({ archived: false })");
    expect(yaml).toContain("SELECT count(*) FROM orders;");
  });

  it("is inert until filled — no numeric rows anywhere", () => {
    const k = parseKnowledge(yaml, "/p")!;
    expect(typeof k.tables.user.rows).not.toBe("number");
    expect((k.tables.user.filters ?? []).every((f) => typeof f.rows !== "number")).toBe(true);
  });
});
