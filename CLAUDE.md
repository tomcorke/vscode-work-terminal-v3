# vscode-work-terminal-v3

Contributor guide for the VS Code extension port of Work Terminal.

## Architecture

The codebase is split across three main areas:

```text
  src/
    extension.ts                  # Extension entry point
    agents/
      AgentLauncher.ts            # Config parsing, executable resolution, launch plans
      AgentProfile.ts             # Built-in Claude/Copilot/Strands profiles
    terminals/
      TerminalSessionStore.ts     # VS Code terminal creation, in-memory session tracking, adapter-backed context prompts
    workItems/
      adapter.ts                  # Parser, mover, renderer, prompt, and config interfaces for work-item sources
      builtInJsonAdapter.ts       # Default workspace-local JSON adapter implementation
      WorkItemStore.ts            # Adapter-driven persistence orchestration with atomic writes
      board.ts                    # Board-facing card, column, and summary types
      createWorkItem.ts           # Work item creation and normalization
      constants.ts                # State, column, source, and priority enums
      snapshot.ts                 # Snapshot validation and normalization helpers
  workTerminal/
    WorkTerminalViewProvider.ts # Webview orchestration and message handling
    renderWorkTerminalHtml.ts   # HTML shell, CSP, bootstrap state
    getNonce.ts                 # Webview script nonce helper
  webview/
    main.ts                     # Browser-side board UI
    styles.css                  # VS Code-themed styling
scripts/
  build.mjs                     # esbuild pipeline for extension + webview bundles
test/
  agents/
  terminals/
  workItems/
  renderWorkTerminalHtml.test.ts
  extensionManifest.test.ts
```

### Runtime boundaries

Keep the VS Code boundary clear:

- `src/extension.ts`, `src/agents`, `src/terminals`, `src/workItems`, and `src/workTerminal` run in the extension host and may use Node APIs plus `vscode`
- `src/webview/*` runs in a browser-like webview context and must not rely on Node built-ins or direct VS Code imports
- Communication between the two halves should stay explicit through typed message payloads handled in `WorkTerminalViewProvider.ts` and `src/webview/main.ts`

### Packaging model

This repo packages as a VS Code extension, not an Obsidian plugin.

- Source TypeScript is bundled into `dist/`
- `dist/extension.js` is the extension-host entry referenced by `package.json`
- `dist/webview/main.js` and `dist/webview/main.css` power the board UI
- `.vscodeignore` determines what lands in the VSIX
- Runtime assets such as `media/work-terminal-activity-bar.svg` must remain package-visible

If you add a new runtime asset, launch config dependency, or packaging requirement, update both the manifest and the tests that guard it.

## Development workflow

### Setup

Use the package manager declared in `package.json`.

```bash
pnpm install
```

### Core commands

```bash
pnpm build      # one-off build for extension host + webview
pnpm watch      # watch both bundles with esbuild
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint over TypeScript sources
pnpm test       # Vitest once
pnpm coverage   # Vitest with V8 coverage
pnpm check      # typecheck + lint + test
pnpm package    # check + build + vsce package
```

### Development host flow

Use the checked-in VS Code configs:

- `Run Work Terminal extension` launches an Extension Development Host after `pnpm: build`
- `Run Vitest suite` launches the test runner under the debugger
- `.vscode/tasks.json` exposes `pnpm: build`, `pnpm: watch`, `pnpm: check`, and `pnpm: coverage`

Recommended loop:

1. Run `pnpm watch` in a terminal.
2. Start `Run Work Terminal extension` with `F5`.
3. Exercise the board in the Extension Development Host.
4. Reload the development host window after rebuilds when needed.
5. Run `pnpm check` before committing.

## Testing

For docs-only changes, tests are usually not required. For code changes, keep validation proportional to the change and prefer the existing scripts.

Minimum expectations:

- `pnpm test` for targeted code changes
- `pnpm check` before merging anything non-trivial
- `pnpm package` when changing packaging, manifest, assets, or publish-time behavior

Key test coverage areas:

- `test/agents/AgentLauncher.test.ts` covers command parsing and launch plans
- `test/terminals/TerminalSessionStore.test.ts` covers terminal creation, delayed context prompts, and session cleanup
- `test/workItems/WorkItemStore.test.ts` covers persistence, locking, and corrupt snapshot handling
- `test/renderWorkTerminalHtml.test.ts` covers CSP bootstrap and escaping
- `test/extensionManifest.test.ts` guards the activity bar icon path and VSIX exclusions

## Issue tracking and PR workflow

Use GitHub Issues as the task list for this repo.

- Start from an existing issue when possible
- Keep branch names issue-oriented, for example `issue-28-docs-parity`
- Reference the issue in commits and PRs with `Refs #N`, `Fixes #N`, or `Closes #N`
- Add progress notes to the issue with `gh issue comment`
- Push branches after committing so issue references and PR automation are visible to collaborators
- Open PRs against `main` unless the issue explicitly says otherwise

Preferred command line flow:

```bash
gh issue view 28
git checkout -b issue-28-docs-parity
# make changes
pnpm check
git commit -m "Docs add contributor guide\n\nCloses #28\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push -u origin issue-28-docs-parity
gh issue comment 28 --body "Summary of what changed"
gh pr create --base main --fill
```

## Debugging

### Extension host

- Use breakpoints with the `Run Work Terminal extension` launch config
- Check the Debug Console for extension-host logging and thrown errors
- Use the Command Palette in the development host to run `Work Terminal: Focus View`, `Work Terminal: Refresh View`, and `Work Terminal: Create Work Item`

### Webview

- Use `Developer: Open Webview Developer Tools` in the Extension Development Host
- Inspect messages flowing between `src/webview/main.ts` and `WorkTerminalViewProvider.ts`
- If a UI change is not showing up, confirm `dist/webview/main.js` and `dist/webview/main.css` were rebuilt, then reload the window

### Persistence and terminal debugging

- Work items persist in `.work-terminal/work-items.v1.json` under the active workspace
- Corrupt snapshots are backed up with a `.corrupt-<timestamp>` suffix
- Terminal sessions are tracked in memory by `TerminalSessionStore` and disappear when the terminals close or the extension host stops
- Context-aware agent profiles send prompts after launch via `terminal.sendText()`, so timing-related regressions usually belong in `TerminalSessionStore`

## Project-specific conventions

### Respect the extension-host / webview split

Do not move Node-only behavior into the webview. Keep filesystem, process resolution, and `vscode` API usage in the extension host.

### Preserve security properties

When touching launch or rendering code:

- keep agent launch args structured, not shell-concatenated
- keep executable validation in `AgentLauncher.ts`
- keep the webview CSP restrictive
- escape user-controlled strings before injecting HTML
- keep `localResourceRoots` narrow

### Preserve schema compatibility unless intentionally versioning

`work-items.v1.json` is versioned. If you change persisted shape or semantics:

- update the snapshot normalization code
- update or add tests in `test/workItems`
- bump versioning logic only when necessary
- document migration behavior clearly in the PR

Note that `abandoned` is a valid internal state that currently maps to the visible `Done` board column.

### Keep settings user-configurable

Do not hardcode local absolute paths for Claude, Copilot, or helper binaries. Use the contributed settings keys and keep defaults simple.

### Packaging changes need packaging checks

If you change any of these, run `pnpm package` and update tests as needed:

- `package.json` contributions or activation events
- `.vscodeignore`
- `media/` assets
- build outputs or entry points

### Dist is generated output

Source files under `src/` and `scripts/` are the source of truth. Rebuild after changing them rather than editing generated files by hand.
