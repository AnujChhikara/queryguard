import { Project, SyntaxKind } from "ts-morph";
import type { SourceFile, CallExpression } from "ts-morph";

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
