import { describe, expect, it } from "vitest";

import { renderWorkTerminalHtml } from "../src/workTerminal/renderWorkTerminalHtml";

describe("renderWorkTerminalHtml", () => {
  it("renders the expected bootstrap shell", () => {
    const html = renderWorkTerminalHtml({
      cspSource: "https://example.invalid",
      nonce: "test-nonce",
      scriptUri: "https://example.invalid/dist/webview/main.js",
      state: {
        status: "Ready",
        workspaceName: "Demo Workspace",
        lastUpdatedLabel: "10:00:00",
      },
      styleUri: "https://example.invalid/dist/webview/main.css",
    });

    expect(html).toContain("Work Terminal");
    expect(html).toContain('id="work-terminal-root"');
    expect(html).toContain("window.__WORK_TERMINAL_INITIAL_STATE__");
    expect(html).toContain("Demo Workspace");
    expect(html).toContain("nonce=\"test-nonce\"");
    expect(html).toContain("https://example.invalid/dist/webview/main.css");
    expect(html).toContain("https://example.invalid/dist/webview/main.js");
  });
});
