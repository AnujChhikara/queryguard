import * as vscode from "vscode";
import { toVsDiagnostics, type MappedDiagnostic } from "./analyze.js";

const TARGET_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
]);

const DEBOUNCE_MS = 300;

function toSeverity(s: MappedDiagnostic["severity"]): vscode.DiagnosticSeverity {
  if (s === "error") return vscode.DiagnosticSeverity.Error;
  if (s === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("queryguard");
  context.subscriptions.push(collection);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function analyzeDocument(doc: vscode.TextDocument): void {
    if (!TARGET_LANGUAGES.has(doc.languageId)) return;
    const mapped = toVsDiagnostics(doc.getText(), doc.fileName);
    const diags = mapped.map((m) => {
      const range = new vscode.Range(
        doc.positionAt(m.startOffset),
        doc.positionAt(m.endOffset),
      );
      const diag = new vscode.Diagnostic(range, m.message, toSeverity(m.severity));
      diag.source = "queryguard";
      diag.code = m.ruleId;
      return diag;
    });
    collection.set(doc.uri, diags);
  }

  function scheduleAnalyze(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        analyzeDocument(doc);
      }, DEBOUNCE_MS),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => scheduleAnalyze(e.document)),
    vscode.workspace.onDidOpenTextDocument((doc) => analyzeDocument(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const existing = timers.get(key);
      if (existing) {
        clearTimeout(existing);
        timers.delete(key);
      }
      collection.delete(doc.uri);
    }),
  );

  if (vscode.window.activeTextEditor) {
    analyzeDocument(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push({
    dispose() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  });
}

export function deactivate(): void {
  // Listeners and the DiagnosticCollection are disposed via context.subscriptions.
}
