import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConfigurationValues = Record<string, string>;

interface MockTerminal {
  dispose: ReturnType<typeof vi.fn>;
  sendText: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
}

const configurationValues: ConfigurationValues = {
  claudeCommand: "claude",
  claudeExtraArgs: "",
  copilotCommand: "copilot",
  copilotExtraArgs: "",
};

const createdTerminals: MockTerminal[] = [];
const closeListeners: Array<(terminal: MockTerminal) => void> = [];

vi.mock("vscode", () => {
  class Disposable {
    public constructor(private readonly callback: () => void) {}

    public dispose(): void {
      this.callback();
    }
  }

  class EventEmitter<T> {
    private readonly listeners = new Set<(value: T) => void>();

    public get event(): (listener: (value: T) => void) => Disposable {
      return (listener) => {
        this.listeners.add(listener);
        return new Disposable(() => {
          this.listeners.delete(listener);
        });
      };
    }

    public fire(value: T): void {
      for (const listener of this.listeners) {
        listener(value);
      }
    }

    public dispose(): void {
      this.listeners.clear();
    }
  }

  return {
    Disposable,
    EventEmitter,
    window: {
      createTerminal: vi.fn(() => {
        const terminal: MockTerminal = {
          dispose: vi.fn(),
          sendText: vi.fn(),
          show: vi.fn(),
        };
        createdTerminals.push(terminal);
        return terminal;
      }),
      onDidCloseTerminal: vi.fn((listener: (terminal: MockTerminal) => void) => {
        closeListeners.push(listener);
        return new Disposable(() => {
          const index = closeListeners.indexOf(listener);
          if (index >= 0) {
            closeListeners.splice(index, 1);
          }
        });
      }),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: <T>(section: string, defaultValue?: T) =>
          ((configurationValues[section] as T | undefined) ?? defaultValue) as T,
      })),
    },
  };
});

describe("TerminalSessionStore", () => {
  beforeEach(() => {
    createdTerminals.length = 0;
    closeListeners.length = 0;
    configurationValues.claudeCommand = "claude";
    configurationValues.claudeExtraArgs = "";
    configurationValues.copilotCommand = "copilot";
    configurationValues.copilotExtraArgs = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("creates shell sessions and counts them by work item", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();

    const session = store.createShellSession("item-1", "Demo item", null, "/workspace");
    const summary = store.getSummary();

    expect(session.kind).toBe("shell");
    expect(summary.sessionCountByItemId["item-1"]).toBe(1);
    expect(createdTerminals).toHaveLength(1);
    expect(createdTerminals[0].show).toHaveBeenCalledWith(true);

    store.dispose();
  });

  it("creates agent sessions and sends context prompts after launch", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();

    const result = store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();
    expect(result.session?.profileId).toBe("claude-context");
    expect(result.session?.resumeSessionId).toMatch(/[0-9a-f-]{36}/);

    vi.runAllTimers();

    expect(createdTerminals[0].sendText).toHaveBeenCalledWith(
      expect.stringContaining("Work item context:"),
      true,
    );

    store.dispose();
  });

  it("does not send a delayed prompt after the terminal has already closed", async () => {
    configurationValues.claudeCommand = process.execPath;

    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();

    const result = store.createAgentSession({
      cwd: "/workspace",
      itemDescription: "Look into the regression",
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude-context",
    });

    expect(result.error).toBeNull();

    closeListeners[0]?.(createdTerminals[0]);
    vi.runAllTimers();

    expect(createdTerminals[0].sendText).not.toHaveBeenCalled();

    store.dispose();
  });

  it("reports missing commands for unavailable profiles", async () => {
    configurationValues.claudeCommand = "definitely-missing-command-for-test";

    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();

    const result = store.createAgentSession({
      cwd: "/workspace",
      itemDescription: null,
      itemId: "item-1",
      itemTitle: "Investigate regression",
      profileId: "claude",
    });

    expect(result.session).toBeNull();
    expect(result.error).toContain("Claude is not available");

    store.dispose();
  });

  it("emits session change events on create and close", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();
    const onChange = vi.fn();
    const disposable = store.onDidChangeSessions(onChange);

    store.createShellSession("item-1", "Demo item", null, "/workspace");
    expect(onChange).toHaveBeenCalledTimes(1);

    closeListeners[0]?.(createdTerminals[0]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(store.getSummary().sessions).toHaveLength(0);

    disposable.dispose();
    store.dispose();
  });

  it("disposes managed terminals when the store is disposed", async () => {
    const { TerminalSessionStore } = await import("../../src/terminals");
    const store = new TerminalSessionStore();

    store.createShellSession("item-1", "Demo item", null, "/workspace");
    store.dispose();

    expect(createdTerminals[0].dispose).toHaveBeenCalledTimes(1);
  });
});
