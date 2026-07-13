import { describe, it, expect } from "vitest";
import { ruleExplanations, explainRule } from "../../src/rules/explanations.js";
import { nPlusOneRule } from "../../src/rules/n-plus-one.js";
import { unboundedReadRule } from "../../src/rules/unbounded-read.js";
import { overFetchRule } from "../../src/rules/over-fetch.js";
import { orderByRandRule } from "../../src/rules/order-by-rand.js";
import { leadingWildcardLikeRule } from "../../src/rules/leading-wildcard-like.js";
import { excessiveJoinsRule } from "../../src/rules/excessive-joins.js";

const allRules = [
  nPlusOneRule,
  unboundedReadRule,
  overFetchRule,
  orderByRandRule,
  leadingWildcardLikeRule,
  excessiveJoinsRule,
];

describe("ruleExplanations", () => {
  it("has a non-empty why and fix for every registered rule", () => {
    for (const rule of allRules) {
      const ex = ruleExplanations[rule.id];
      expect(ex, `missing explanation for ${rule.id}`).toBeDefined();
      expect(ex.why.length).toBeGreaterThan(0);
      expect(ex.fix.length).toBeGreaterThan(0);
    }
  });

  it("explainRule returns the entry for a known rule", () => {
    expect(explainRule("n-plus-one")).toEqual(ruleExplanations["n-plus-one"]);
  });

  it("explainRule returns undefined for an unknown rule", () => {
    expect(explainRule("no-such-rule")).toBeUndefined();
  });
});
