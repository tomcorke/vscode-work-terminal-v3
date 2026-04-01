import * as vscode from "vscode";

import { getNonce } from "./getNonce";
import {
  renderWorkTerminalHtml,
  type WorkTerminalViewState,
} from "./renderWorkTerminalHtml";
import type { WorkItemStore } from "../workItems";

type WorkTerminalWebviewMessage =
  | { readonly type: "ready" }
  | { readonly type: "refresh-requested" };

export class WorkTerminalViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "workTerminal.view";

  private view: vscode.WebviewView | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly disposables: vscode.Disposable[],
    private readonly store: WorkItemStore,
  ) {}

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"),
    );
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    webviewView.webview.html = renderWorkTerminalHtml({
      cspSource: webviewView.webview.cspSource,
      nonce: getNonce(),
      scriptUri: scriptUri.toString(),
      state: await this.createViewState("Scaffold ready"),
      styleUri: styleUri.toString(),
    });

    webviewView.webview.onDidReceiveMessage(
      async (message: WorkTerminalWebviewMessage) => {
        if (message.type === "ready") {
          await this.postState("Work Terminal view connected");
          return;
        }

        if (message.type === "refresh-requested") {
          await this.refresh();
        }
      },
      undefined,
      this.disposables,
    );
  }

  public reveal(): void {
    this.view?.show?.(true);
  }

  public async refresh(status = "Refreshed work item state from extension host"): Promise<void> {
    await this.postState(status);
  }

  private async postState(status: string): Promise<void> {
    const state = await this.createViewState(status);

    await this.view?.webview.postMessage({
      type: "state-updated",
      payload: state,
    });
  }

  private async createViewState(status: string): Promise<WorkTerminalViewState> {
    const summary = await this.store.getSummary();

    return {
      columnSummaries: summary.columnSummaries,
      latestWorkItemTitle: summary.latestWorkItemTitle,
      status,
      storagePath: summary.storagePath,
      totalWorkItems: summary.totalCount,
      workspaceName:
        vscode.workspace.name ??
        vscode.workspace.workspaceFolders?.[0]?.name ??
        "No workspace",
      lastUpdatedLabel: new Date().toLocaleTimeString(),
    };
  }
}
