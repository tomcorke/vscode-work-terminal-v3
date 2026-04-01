import { TerminalSessionStore } from "./terminals";
import * as vscode from "vscode";

import { WorkTerminalViewProvider } from "./workTerminal/WorkTerminalViewProvider";
import { WorkItemStore } from "./workItems";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
  const store = new WorkItemStore(workspaceRootPath);
  const terminalStore = new TerminalSessionStore(workspaceRootPath);
  const recovery = await terminalStore.restorePersistedSessions();
  const provider = new WorkTerminalViewProvider(
    context.extensionUri,
    context.subscriptions,
    store,
    terminalStore,
  );

  if (recovery.restoredCount > 0 || recovery.skippedCount > 0) {
    const restoredLabel = recovery.restoredCount > 0
      ? `Recovered ${recovery.restoredCount} terminal session${recovery.restoredCount === 1 ? "" : "s"}`
      : null;
    const skippedLabel = recovery.skippedCount > 0
      ? `skipped ${recovery.skippedCount} saved session${recovery.skippedCount === 1 ? "" : "s"}`
      : null;
    await provider.refresh([restoredLabel, skippedLabel].filter(Boolean).join("; "));
  }

  context.subscriptions.push(
    terminalStore,
    vscode.window.registerWebviewViewProvider(
      WorkTerminalViewProvider.viewType,
      provider,
    ),
    vscode.commands.registerCommand("workTerminal.focus", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.workTerminal");
      provider.reveal();
    }),
    vscode.commands.registerCommand("workTerminal.refreshView", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.workTerminal");
      await provider.refresh();
    }),
    vscode.commands.registerCommand("workTerminal.createWorkItem", async () => {
      await provider.createWorkItemFromPrompt();
    }),
  );
}

export function deactivate(): void {}
