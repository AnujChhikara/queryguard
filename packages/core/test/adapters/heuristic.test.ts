import { describe, it, expect } from "vitest";
import { SyntaxKind } from "ts-morph";
import { parseSource, findCallExpressions } from "../../src/parse.js";
import { heuristicAdapter } from "../../src/adapters/heuristic.js";

function firstCall(code: string, calleeText: string) {
  const sf = parseSource(code);
  return findCallExpressions(sf).find((c) => c.getExpression().getText() === calleeText)!;
}

describe("heuristicAdapter", () => {
  it("returns null for a non-call node (tagged template)", () => {
    const sf = parseSource("async function r(sql){ await sql`SELECT 1`; }");
    const tagged = sf.getFirstDescendantByKind(SyntaxKind.TaggedTemplateExpression)!;
    expect(heuristicAdapter(tagged)).toBeNull();
  });

  it("recognizes an awaited custom data-access call (verb match)", () => {
    const call = firstCall(`async function r(){ await dataAccess.retrieveUsers({ id: 1 }); }`, "dataAccess.retrieveUsers");
    const d = heuristicAdapter(call);
    expect(d).not.toBeNull();
    expect(d!.confidence).toBe("heuristic");
    expect(d!.operation).toBe("unknown");
    expect(d!.hasLimit).toBeUndefined();
    expect(d!.hasFilter).toBeUndefined();
    expect(d!.selectedFields).toBeUndefined();
  });

  it("recognizes an awaited call on a data-source receiver (mongoose find)", () => {
    const call = firstCall(`async function r(User){ await User.find({ active: true }); }`, "User.find");
    // 'find' is a query verb -> recognized
    expect(heuristicAdapter(call)).not.toBeNull();
  });

  it("does NOT recognize a synchronous array method (not awaited)", () => {
    const call = firstCall(`function r(arr){ return arr.find(x => x.id === 1); }`, "arr.find");
    expect(heuristicAdapter(call)).toBeNull();
  });

  it("does NOT recognize a blocklisted method even if awaited", () => {
    const call = firstCall(`async function r(res, data){ await res.json(data); }`, "res.json");
    expect(heuristicAdapter(call)).toBeNull();
  });

  it("does NOT recognize a bare function call (no property access)", () => {
    const call = firstCall(`async function r(){ await getUser(1); }`, "getUser");
    expect(heuristicAdapter(call)).toBeNull();
  });

  it("does NOT recognize .then() even if awaited", () => {
    const call = firstCall(`async function r(p){ await p.then(() => 1); }`, "p.then");
    expect(heuristicAdapter(call)).toBeNull();
  });
});
