# Corpus — real-world reports, frozen as tests

One file per confirmed report from a user, named
`<kind>-<issue#>-<slug>.test.ts` where kind is `fp` (false positive),
`mc` (missed catch), or `crash`. Each file embeds the reported snippet inline
and asserts the **correct** verdict via `analyzeSource`.

Rules:

- A corpus test is added in the same PR that fixes the report, and links the
  issue in a comment.
- Corpus tests are never deleted — they are the guarantee that a fixed report
  can't regress.
- Seed cases (predating the report flow) use no issue number.
