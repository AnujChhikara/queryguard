# cardinal-core

The static, database-aware analysis engine behind [Cardinal](https://github.com/AnujChhikara/cardinal).
Parses TypeScript/JavaScript with ts-morph, normalizes query calls (Prisma,
Drizzle, Mongoose, raw SQL) into descriptors, runs rules, and emits diagnostics.
100% static — no LLM, no network, no database connection.

```ts
import { analyzeSource } from "cardinal-core";

const diagnostics = analyzeSource(
  `for (const u of users) { await prisma.post.findMany({ where: { authorId: u.id } }); }`,
);
// → [{ ruleId: "n-plus-one", severity: "error", ... }]
```

`analyzeSource(code, filePath?, knowledge?, config?)` optionally takes a parsed
knowledge file (data-scale facts) and config (rule on/off + severity). See the
[main README](https://github.com/AnujChhikara/cardinal#readme) for the full model.

MIT.
