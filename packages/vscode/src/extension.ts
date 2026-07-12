import * as vscode from "vscode";
import { dirname } from "node:path";
import { toVsDiagnostics, type MappedDiagnostic } from "./analyze.js";
import { KnowledgeCache } from "./knowledge-cache.js";

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

function knowledgeEnabled(): boolean {
  return vscode.workspace.getConfiguration("queryguard").get<boolean>("useKnowledge", true);
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("queryguard");
  context.subscriptions.push(collection);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const knowledgeCache = new KnowledgeCache();

  function analyzeDocument(doc: vscode.TextDocument): void {
    if (!TARGET_LANGUAGES.has(doc.languageId)) return;
    // Discover a queryguard.knowledge.yaml above the file being analyzed. The
    // cache keeps the upward filesystem walk off the debounced hot path.
    const knowledge = knowledgeEnabled() ? knowledgeCache.get(dirname(doc.fileName)) : null;
    const mapped = toVsDiagnostics(doc.getText(), doc.fileName, knowledge);
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

  // Invalidate the knowledge cache and re-lint every open document. Called when
  // a knowledge file changes on disk or the useKnowledge setting is toggled.
  function refreshKnowledge(): void {
    knowledgeCache.clear();
    for (const doc of vscode.workspace.textDocuments) analyzeDocument(doc);
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    "**/queryguard.knowledge.{yaml,yml,json}",
  );
  watcher.onDidChange(refreshKnowledge);
  watcher.onDidCreate(refreshKnowledge);
  watcher.onDidDelete(refreshKnowledge);
  context.subscriptions.push(watcher);

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
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("queryguard.useKnowledge")) refreshKnowledge();
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
