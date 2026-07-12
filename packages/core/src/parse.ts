import { Project, SyntaxKind } from "ts-morph";
import type { SourceFile, CallExpression, Node } from "ts-morph";

const project = new Project({
  useInMemoryFileSystem: true,
  compilerOptions: { allowJs: true },
  skipFileDependencyResolution: true,
});

let counter = 0;

export function parseSource(code: string, filePath?: string): SourceFile {
  const name = filePath ?? `__queryguard_${counter++}.ts`;
  return project.createSourceFile(name, code, { overwrite: true });
}

export function findCallExpressions(sourceFile: SourceFile): CallExpression[] {
  return sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
}

/**
 * All nodes an adapter may recognize as a query: call expressions plus tagged
 * template expressions (e.g. `sql`...``, used by raw-SQL adapters). Returned in
 * source order.
 */
export function findQueryCandidates(sourceFile: SourceFile): Node[] {
  return sourceFile
    .getDescendants()
    .filter(
      (n) =>
        n.getKind() === SyntaxKind.CallExpression ||
        n.getKind() === SyntaxKind.TaggedTemplateExpression,
    );
}
