import * as vscode from "vscode";

import { WorkTerminalViewProvider } from "./workTerminal/WorkTerminalViewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WorkTerminalViewProvider(context.extensionUri, context.subscriptions);

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
  );
}

export function deactivate(): void {}
