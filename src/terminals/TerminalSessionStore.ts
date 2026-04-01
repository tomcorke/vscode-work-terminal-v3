import * as vscode from "vscode";

export interface TerminalSessionSummary {
  readonly id: string;
  readonly itemId: string;
  readonly itemTitle: string;
  readonly kind: "shell";
  readonly label: string;
}

export interface TerminalStoreSummary {
  readonly sessionCountByItemId: Record<string, number>;
  readonly sessions: readonly TerminalSessionSummary[];
}

interface StoredTerminalSession {
  readonly summary: TerminalSessionSummary;
  readonly terminal: vscode.Terminal;
}

export class TerminalSessionStore implements vscode.Disposable {
  private readonly closeDisposable: vscode.Disposable;
  private readonly sessionsChangedEmitter = new vscode.EventEmitter<void>();
  private readonly sessionsById = new Map<string, StoredTerminalSession>();

  public constructor() {
    this.closeDisposable = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [id, session] of this.sessionsById) {
        if (session.terminal === terminal) {
          this.sessionsById.delete(id);
          this.sessionsChangedEmitter.fire();
        }
      }
    });
  }

  public get onDidChangeSessions(): vscode.Event<void> {
    return this.sessionsChangedEmitter.event;
  }

  public createShellSession(itemId: string, itemTitle: string, cwd: string | undefined): TerminalSessionSummary {
    const id = crypto.randomUUID();
    const label = `${itemTitle} - Shell`;
    const terminal = vscode.window.createTerminal({
      cwd,
      name: label,
    });
    const summary: TerminalSessionSummary = {
      id,
      itemId,
      itemTitle,
      kind: "shell",
      label,
    };

    this.sessionsById.set(id, { summary, terminal });
    this.sessionsChangedEmitter.fire();
    terminal.show(true);

    return summary;
  }

  public focusSession(id: string): boolean {
    const session = this.sessionsById.get(id);
    if (!session) {
      return false;
    }

    session.terminal.show(true);
    return true;
  }

  public getSummary(): TerminalStoreSummary {
    const sessions = Array.from(this.sessionsById.values()).map((session) => session.summary);
    const sessionCountByItemId: Record<string, number> = {};

    for (const session of sessions) {
      sessionCountByItemId[session.itemId] = (sessionCountByItemId[session.itemId] ?? 0) + 1;
    }

    return {
      sessionCountByItemId,
      sessions,
    };
  }

  public dispose(): void {
    this.closeDisposable.dispose();
    for (const session of this.sessionsById.values()) {
      session.terminal.dispose();
    }
    this.sessionsChangedEmitter.dispose();
    this.sessionsById.clear();
  }
}
