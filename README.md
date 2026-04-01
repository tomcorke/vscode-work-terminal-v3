# vscode-work-terminal-v3

VS Code port of `obsidian-work-terminal`, rebuilt for the VS Code extension host and webview model.

## Current status

This repository is in active bootstrap. The first implementation slice sets up:

- TypeScript extension scaffolding
- bundled extension-host and webview assets
- a registered `Work Terminal` activity bar view
- baseline linting, type checking, and unit tests

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
3. Start `npm run watch` in a terminal.
4. Press `F5` using the `Run Work Terminal extension` launch config.
5. Open the `Work Terminal` activity bar view.

The repository now includes:

- `.vscode/launch.json` for extension-host and Vitest debugging
- `.vscode/tasks.json` for build, watch, check, and coverage tasks

## Planned architecture

The extension is being shaped around the same broad responsibilities as the Obsidian implementation:

- extension-host orchestration for VS Code APIs
- a webview-based board and terminal UI shell
- future terminal/session, persistence, and agent integration layers

The initial scaffold keeps those boundaries in place without implementing terminal management yet.
