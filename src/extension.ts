import * as vscode from "vscode";

import { WorkTerminalViewProvider } from "./workTerminal/WorkTerminalViewProvider";
import { WorkItemStore } from "./workItems";

export function activate(context: vscode.ExtensionContext): void {
  const store = new WorkItemStore(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null);
  const provider = new WorkTerminalViewProvider(context.extensionUri, context.subscriptions, store);

  context.subscriptions.push(
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
