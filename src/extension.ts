import * as vscode from "vscode";

import { WorkTerminalViewProvider } from "./workTerminal/WorkTerminalViewProvider";
import { WorkItemStore, type WorkItemState } from "./workItems";

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
      await provider.refresh();
    }),
    vscode.commands.registerCommand("workTerminal.createWorkItem", async () => {
      const title = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        prompt: "Create a work item",
        placeHolder: "Investigate task sync bug",
        validateInput: (value) => (value.trim().length > 0 ? null : "A title is required."),
      });

      if (!title) {
        return;
      }

      const state = await promptForState();
      if (!state) {
        return;
      }

      const item = await store.createWorkItem({ title, state });

      if (!item) {
        void vscode.window.showWarningMessage("Work Terminal needs an open workspace to persist work items.");
        return;
      }

      await provider.refresh(`Created "${item.title}"`);
      void vscode.window.showInformationMessage(`Created work item "${item.title}".`);
    }),
  );
}

export function deactivate(): void {}

async function promptForState(): Promise<WorkItemState | undefined> {
  const choices: Array<{ readonly label: string; readonly state: WorkItemState }> = [
    { label: "To Do", state: "todo" },
    { label: "Active", state: "active" },
    { label: "Priority", state: "priority" },
    { label: "Done", state: "done" },
  ];

  const selection = await vscode.window.showQuickPick(
    choices.map((choice) => ({
      label: choice.label,
      state: choice.state,
    })),
    {
      ignoreFocusOut: true,
      placeHolder: "Choose the initial state",
    },
  );

  return selection?.state;
}
