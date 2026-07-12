import * as vscode from "vscode";
import { dirname } from "node:path";
import { toVsDiagnostics, type MappedDiagnostic } from "./analyze.js";
import { KnowledgeCache } from "./knowledge-cache.js";
import { performSuppression, type SuppressIO } from "./suppress-action.js";

const TARGET_LANGUAGES = new Set([
  "typescript",
  "javascript",
  "typescriptreact",
  "javascriptreact",
]);

const DEBOUNCE_MS = 300;
const SUPPRESS_COMMAND = "cardinal.suppress";

interface SuppressArgs {
  uri: string;
  ruleId: string;
  line: number;
}

/** Offers a "Suppress …" quick-fix on each Cardinal diagnostic under the cursor. */
class SuppressProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter((d) => d.source === "cardinal" && typeof d.code === "string")
      .map((d) => {
        const action = new vscode.CodeAction(
          `Suppress "${String(d.code)}" (Cardinal)`,
          vscode.CodeActionKind.QuickFix,
        );
        action.diagnostics = [d];
        const args: SuppressArgs = {
          uri: document.uri.toString(),
          ruleId: String(d.code),
          line: d.range.start.line + 1, // vscode 0-based → core 1-based
        };
        action.command = { command: SUPPRESS_COMMAND, title: "Suppress finding", arguments: [args] };
        return action;
      });
  }
}

function toSeverity(s: MappedDiagnostic["severity"]): vscode.DiagnosticSeverity {
  if (s === "error") return vscode.DiagnosticSeverity.Error;
  if (s === "warning") return vscode.DiagnosticSeverity.Warning;
  return vscode.DiagnosticSeverity.Information;
}

function knowledgeEnabled(): boolean {
  return vscode.workspace.getConfiguration("cardinal").get<boolean>("useKnowledge", true);
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("cardinal");
  context.subscriptions.push(collection);

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const knowledgeCache = new KnowledgeCache();

  function analyzeDocument(doc: vscode.TextDocument): void {
    if (!TARGET_LANGUAGES.has(doc.languageId)) return;
    // Discover a cardinal.knowledge.yaml above the file being analyzed. The
    // cache keeps the upward filesystem walk off the debounced hot path.
    const knowledge = knowledgeEnabled() ? knowledgeCache.get(dirname(doc.fileName)) : null;
    const mapped = toVsDiagnostics(doc.getText(), doc.fileName, knowledge);
    const diags = mapped.map((m) => {
      const range = new vscode.Range(
        doc.positionAt(m.startOffset),
        doc.positionAt(m.endOffset),
      );
      const diag = new vscode.Diagnostic(range, m.message, toSeverity(m.severity));
      diag.source = "cardinal";
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
    "**/cardinal.knowledge.{yaml,yml,json}",
  );
  watcher.onDidChange(refreshKnowledge);
  watcher.onDidCreate(refreshKnowledge);
  watcher.onDidDelete(refreshKnowledge);
  context.subscriptions.push(watcher);

  // Suppression quick-fix: lightbulb on a Cardinal diagnostic → write a
  // suppression (and optional cardinality fact) to the knowledge file.
  async function runSuppress(args: SuppressArgs): Promise<void> {
    const uri = vscode.Uri.parse(args.uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const io: SuppressIO = {
      askReason: async () =>
        vscode.window.showInputBox({
          title: "Suppress finding",
          prompt: "Why are you suppressing this? (optional)",
          placeHolder: "e.g. this list is admin-curated and capped at 20",
        }),
      confirmFact: async (table, rows) =>
        (await vscode.window.showInformationMessage(
          `Also record fact: tables.${table}.rows = ${rows}?`,
          "Record",
          "Skip",
        )) === "Record",
    };
    const res = await performSuppression(
      {
        code: doc.getText(),
        absPath: doc.fileName,
        relPath: vscode.workspace.asRelativePath(uri, false),
        line: args.line,
        ruleId: args.ruleId,
        workspaceRoot: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath,
      },
      io,
    );
    if (res.ok) {
      refreshKnowledge();
      void vscode.window.showInformationMessage(`Cardinal: ${res.message}`);
    } else if (res.error !== "cancelled") {
      void vscode.window.showWarningMessage(`Cardinal: ${res.error}`);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(SUPPRESS_COMMAND, runSuppress),
    vscode.languages.registerCodeActionsProvider(
      [...TARGET_LANGUAGES].map((language) => ({ language })),
      new SuppressProvider(),
      { providedCodeActionKinds: SuppressProvider.providedCodeActionKinds },
    ),
  );

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
      if (e.affectsConfiguration("cardinal.useKnowledge")) refreshKnowledge();
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
