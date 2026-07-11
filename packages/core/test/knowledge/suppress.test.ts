import { describe, it, expect } from "vitest";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { prismaAdapter } from "../../src/adapters/prisma.js";
import { computeAnchor, filterSuppressed } from "../../src/knowledge/suppress.js";
import { parseKnowledge } from "../../src/knowledge/load.js";
import type { QueryDescriptor, Diagnostic } from "../../src/types.js";

function descriptors(code: string): QueryDescriptor[] {
  const sf = parseSource(code);
  return findCallExpressions(sf).map((c) => prismaAdapter(c)).filter((d): d is QueryDescriptor => d !== null);
}

describe("computeAnchor", () => {
  it("captures the enclosing function name and normalized call text", () => {
    const d = descriptors(`async function syncContacts(prisma){ await prisma.contact.findMany({ where: { active: true } }); }`)[0];
    const a = computeAnchor(d.node);
    expect(a.fn).toBe("syncContacts");
    expect(a.anchor).toBe('prisma.contact.findMany({ where: { active: true } })');
  });
});

describe("filterSuppressed", () => {
  const code = `async function syncContacts(prisma){ await prisma.contact.findMany({ where: { active: true } }); }`;
  const ds = descriptors(code);
  const diag: Diagnostic = {
    ruleId: "over-fetch",
    severity: "warning",
    message: "x",
    range: { start: ds[0].node.getStart(), end: ds[0].node.getEnd(), line: 1, column: 1 },
  };

  it("drops a diagnostic that matches a suppression", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
suppressions:
  - rule: over-fetch
    file: src/contacts.ts
    fn: syncContacts
    anchor: "prisma.contact.findMany({ where: { active: true } })"
`,
      "/p",
    );
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", k)).toHaveLength(0);
  });

  it("keeps a diagnostic when rule/fn/anchor differ", () => {
    const k = parseKnowledge(
      `version: 1
tables: {}
suppressions:
  - rule: n-plus-one
    file: src/contacts.ts
    fn: syncContacts
    anchor: "prisma.contact.findMany({ where: { active: true } })"
`,
      "/p",
    );
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", k)).toHaveLength(1);
  });

  it("keeps everything when there is no knowledge", () => {
    expect(filterSuppressed([diag], ds, "/abs/src/contacts.ts", null)).toHaveLength(1);
  });
});
