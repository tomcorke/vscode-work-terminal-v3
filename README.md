# vscode-work-terminal-v3

VS Code port of `obsidian-work-terminal`, rebuilt for the VS Code extension host and webview model.

## Current status

The current branch delivers a functional vertical slice of the VS Code port:

- a `Work Terminal` activity bar view with a webview-based board
- persisted work items stored in `.work-terminal/work-items.v1.json` inside the current workspace
- create-work-item flow from the extension host
- per-item shell terminals
- configurable Claude and Copilot launch profiles with work-item context prompts
- linting, type checking, unit tests, coverage, and VSIX packaging

## Development

Install dependencies:

```bash
npm install
```

Build once:

```bash
npm run build
```

Watch during development:

```bash
npm run watch
```

Run validation:

```bash
npm run check
```

Generate a coverage report:

```bash
npm run coverage
```

## Launching in VS Code

1. Open this repository in VS Code.
2. Run `npm install`.
3. Press `F5` using the `Run Work Terminal extension` launch config.
4. Open the `Work Terminal` activity bar view.
5. Use `Work Terminal: Create Work Item` or the in-view controls to seed items in the current workspace.
6. Launch shell, Claude, or Copilot sessions from a selected work item.

For iterative rebuilds while you edit, you can still run `npm run watch` manually in a terminal.

The repository now includes:

- `.vscode/launch.json` for extension-host and Vitest debugging
- `.vscode/tasks.json` for build, watch, check, and coverage tasks
- built-in settings for `workTerminal.claudeCommand`, `workTerminal.claudeExtraArgs`, `workTerminal.copilotCommand`, and `workTerminal.copilotExtraArgs`

## Architecture snapshot

The extension currently mirrors the same high-level split as the Obsidian implementation:

- extension-host orchestration for VS Code APIs
- a webview-based board UI
- file-backed work-item persistence
- terminal/session and agent launch helpers

Parity gaps with the Obsidian plugin are still expected, but the repo is past the bare scaffold stage and now supports board state, terminal launches, and agent-aware session metadata.
