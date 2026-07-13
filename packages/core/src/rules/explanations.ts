/**
 * Reusable, per-rule "why it matters" + "how to fix" copy. The specifics of a
 * given finding (target table, cardinality) live in the diagnostic's message;
 * this is the generic guidance an AI agent or an editor hover-card can attach.
 */
export interface RuleExplanation {
  /** Why this pattern is a problem — the reasoning, in one or two sentences. */
  why: string;
  /** The canonical fix. */
  fix: string;
}

export const ruleExplanations: Record<string, RuleExplanation> = {
  "n-plus-one": {
    why: "A query awaited inside a loop runs once per iteration — 1 + N round trips to the database. The cost grows with the loop, so a set that is small today can dominate latency as the data grows.",
    fix: "Hoist the query out of the loop: collect the keys, run one batched query (a WHERE ... IN / Prisma findMany with an `in` filter, or an ORM include/join), then group the rows in memory.",
  },
  "unbounded-read": {
    why: "A read with no WHERE filter and no LIMIT can scan and return the entire table. The result set — and the memory and latency it costs — grows without bound as the table grows.",
    fix: "Add a selective WHERE/where filter, or cap the result with LIMIT/take (with cursor/offset pagination if you need more than one page).",
  },
  "over-fetch": {
    why: "An unfiltered read on a table the knowledge file marks large returns far more rows than the code needs, when a selective filter would return a small subset.",
    fix: "Add the selective filter identified in the knowledge file (e.g. status = 'active') so the query returns the small subset instead of scanning the whole table.",
  },
  "order-by-rand": {
    why: "ORDER BY RAND()/RANDOM() assigns a random key to every row and sorts the full result set — it can't use an index, so the cost grows with table size.",
    fix: "Pick random rows without a full sort: select by a random offset, sample via a WHERE on an indexed random-bucket column, or use TABLESAMPLE where supported.",
  },
  "leading-wildcard-like": {
    why: "LIKE '%…' has a leading wildcard, so the database can't use a B-tree index on the column and falls back to a full scan.",
    fix: "Anchor the pattern to the start ('abc%') so an index can be used, or move substring search to a full-text or trigram (GIN) index.",
  },
  "excessive-joins": {
    why: "Joining many tables in one query enlarges the query planner's search space and can multiply intermediate row counts, making the query slow and hard to plan.",
    fix: "Reduce the join fan-out: split into smaller queries, denormalize a hot read path, or fetch related data in separate batched queries.",
  },
};

/** The explanation for a rule id, or undefined if none is registered. */
export function explainRule(ruleId: string): RuleExplanation | undefined {
  return ruleExplanations[ruleId];
}
