// Bump all publishable package versions in lockstep (surgical — only the version
// field changes, formatting is preserved).
// Usage: node scripts/set-version.mjs 0.2.0   (or: pnpm release:version 0.2.0)
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("usage: node scripts/set-version.mjs <X.Y.Z>");
  process.exit(1);
}

const files = [
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/vscode/package.json",
];

const VERSION_RE = /("version":\s*")[^"]+(")/;

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (!VERSION_RE.test(content)) {
    console.error(`  ! no "version" field found in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, content.replace(VERSION_RE, `$1${version}$2`));
  console.log(`  ${file} → ${version}`);
}

console.log(`\nSet ${files.length} packages to ${version}. Next:`);
console.log(`  git commit -am "release: v${version}" && git tag v${version}`);
console.log(`  git push --follow-tags`);
