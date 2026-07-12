import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/extension.ts"],
  format: ["cjs"],
  external: ["vscode"],
  noExternal: ["cardinal-core"],
  outDir: "dist",
  clean: true,
});
