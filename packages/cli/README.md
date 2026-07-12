# @cardinal/cli

The command-line linter for [Cardinal](https://github.com/AnujChhikara/cardinal)
— a static, database-aware analyzer for TypeScript/JavaScript. Flags N+1 loops,
unbounded reads, and over-fetching, and exits non-zero on any error (so it gates
CI).

```bash
npm i -D @cardinal/cli
npx cardinal "src/**/*.ts"
```

Flags: `--knowledge <path>` / `--no-knowledge` (data-scale facts),
`--no-config` (ignore `cardinal.config`). Suppress a finding with
`cardinal suppress <file>:<line>`.

See the [main README](https://github.com/AnujChhikara/cardinal#readme) for the
knowledge file, config, and rule details. MIT.
