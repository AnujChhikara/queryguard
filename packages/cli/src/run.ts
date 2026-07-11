import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import { analyzeSource } from "@queryguard/core";
import type { Diagnostic, Knowledge } from "@queryguard/core";

export interface FileDiagnostic extends Diagnostic {
  file: string;
}

export async function run(
  patterns: string[],
  cwd: string,
  options: { knowledge?: Knowledge | null } = {},
): Promise<{ diagnostics: FileDiagnostic[]; errorCount: number }> {
  const files = await fg(patterns, { cwd, absolute: false });
  const diagnostics: FileDiagnostic[] = [];

  for (const file of files) {
    const abs = join(cwd, file);
    let code: string;
    try {
      code = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    for (const diag of analyzeSource(code, abs, options.knowledge ?? null)) {
      diagnostics.push({ ...diag, file });
    }
  }

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  return { diagnostics, errorCount };
}
