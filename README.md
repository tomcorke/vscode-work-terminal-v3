# vscode-work-terminal-v3

VS Code port of `obsidian-work-terminal`, adapted to the VS Code extension host, webview, and terminal APIs.

## Current scope

This repository is past the empty scaffold stage and already ships a usable vertical slice:

- `Work Terminal` activity bar container with a `Board` webview
- workspace-local work item persistence in `.work-terminal/work-items.v1.json`
- create-work-item flow from the extension host
- board drag-and-drop reordering with persisted cross-column moves
- persisted column collapse state plus local text filtering in the webview
- richer selected-item detail metadata plus work-item action flows in the webview
- per-item shell terminals
- Claude and GitHub Copilot CLI launch profiles, with optional work-item context prompts
- workspace-local terminal session persistence in `.work-terminal/terminal-sessions.v1.json`
- activation-time relaunch of saved sessions, including reuse of Claude `--session-id` values for resume-aware recovery
- command readiness checks for configured agent binaries
- unit tests, coverage, linting, type checking, and VSIX packaging

It does not yet match the full Obsidian plugin feature set. The current implementation focuses on the VS Code-native board, terminal launching, persistence, and packaging foundations.

## Feature overview

### Board and work items

- Four visible board columns: `Priority`, `To Do`, `Active`, and `Done`
- Workspace-local snapshot storage with atomic write-then-rename persistence
- Drag-and-drop item movement within and across columns, backed by persisted ordering
- Persisted per-column collapse state and local text filtering in the webview
- Column counts, latest item summary, and a richer selected-item detail panel in the webview
- Quick create flow using `Work Terminal: Create Work Item`
- Rich selected-item metadata display for blocker reasons, deadlines, priority scores, source links or paths, and lifecycle timestamps
- VS Code-native work-item actions from the detail panel, including edit details, edit metadata, move item, split task, open source, delete, and a More actions quick-pick flow

### Terminal sessions

- Shell sessions launched from the selected work item
- Claude and Copilot launchers, each with standard and context-aware profiles:
  - `Claude`
  - `Claude (ctx)`
  - `Copilot`
  - `Copilot (ctx)`
- Session tracking in the extension host, grouped back onto the originating work item
- Workspace-local persistence, activation-time relaunch, and recently closed reopen flow for recoverable sessions
- Best-effort agent session-state badges (`Active`, `Waiting`, `Idle`) based on host-visible VS Code terminal signals
- Best-effort agent rename tracking when VS Code updates the terminal title exposed to the extension host
- Terminal refocus actions from the webview
- Claude launches get a generated `--session-id` so resume-aware workflows can key off the initial launch

### VS Code integration

- Activity bar container and board view contribution in `package.json`
- Extension commands:
  - `Work Terminal: Focus View`
  - `Work Terminal: Refresh View`
  - `Work Terminal: Create Work Item`
- Extension-host and Vitest launch configs in `.vscode/launch.json`
- Build, watch, check, and coverage tasks in `.vscode/tasks.json`

## Requirements

- VS Code `^1.99.0`
- `pnpm@10.32.1` as declared in `package.json`

If you use Corepack, this is enough to get the expected package manager version:

```bash
corepack enable
corepack prepare pnpm@10.32.1 --activate
```

## Install and development flow

Clone the repository and install dependencies:

```bash
git clone git@github.com:tomcorke/vscode-work-terminal-v3.git
cd vscode-work-terminal-v3
pnpm install
```

Build once:

```bash
pnpm build
```

Run the full local validation suite:

```bash
pnpm check
```

Useful development commands:

```bash
pnpm watch      # rebuild extension + webview on change
pnpm test       # run Vitest once
pnpm coverage   # run tests with V8 coverage
pnpm package    # check, build, then create a VSIX via vsce
```

## Launch and debug flow

1. Open this repository in VS Code.
2. Run `pnpm install` if you have not already.
3. Press `F5` and choose `Run Work Terminal extension`.
4. In the Extension Development Host window, open the `Work Terminal` activity bar container.
5. Use `Work Terminal: Create Work Item` or the webview button to seed items in the current workspace.
6. Select an item, review its metadata in the detail panel, then launch a shell or agent session or run item actions such as move, split, open source, or edit metadata.

Recommended iteration loop:

- Run `pnpm watch` in a terminal for continuous rebuilds.
- Use the `Run Work Terminal extension` launch config for extension-host debugging.
- Use the `Run Vitest suite` launch config for debugger-attached test runs.
- Use `Developer: Open Webview Developer Tools` when debugging the board UI.
- Use `Developer: Reload Window` in the Extension Development Host after rebuilds when you need the extension and webview to pick up fresh output.

Saved sessions are re-launched when the extension activates again in the same workspace. This restores session metadata and relaunches the terminal command, but it does not restore prior terminal buffer contents or shell history.

Recently closed sessions remain available from the selected item's terminal panel until they are reopened or pruned by retention rules.

## Architecture summary

The repo follows the VS Code split between extension-host code and a sandboxed webview bundle.

### Extension host

The extension-host side owns VS Code API integration, persistence, terminal lifecycle, and agent launch planning.

- `src/extension.ts` - activates the extension, wires commands, stores, and the webview provider
- `src/workTerminal/WorkTerminalViewProvider.ts` - owns the webview bridge and user action handling
- `src/workItems/WorkItemStore.ts` - loads and saves `.work-terminal/work-items.v1.json`, with a write queue and corrupt snapshot recovery
- `src/terminals/TerminalSessionStore.ts` - creates shell and agent terminals, persists recoverable session metadata, restores saved sessions, and refocuses terminals
- `src/terminals/TerminalSessionPersistence.ts` - loads and saves `.work-terminal/terminal-sessions.v1.json`, with atomic writes and corrupt snapshot recovery
- `src/agents/AgentLauncher.ts` - resolves configured commands, splits quoted arguments, validates executables, and builds launch plans
- `src/agents/AgentProfile.ts` - defines the built-in Claude, Copilot, and Strands defaults plus the work-item context prompt format
- `src/agents/AgentProfileConfiguration.ts` - loads profile settings, validates custom profiles, and serializes profile edits

### Webview

The board UI is bundled separately for the browser runtime.

- `src/workTerminal/renderWorkTerminalHtml.ts` - emits the HTML shell, CSP, bootstrap state, and resource URIs
- `src/webview/main.ts` - renders the board UI, posts actions back to the extension host, and persists selected state through the VS Code webview state API
- `src/webview/styles.css` - board and session styling using VS Code theme tokens

### Build and packaging

- `scripts/build.mjs` bundles both targets with esbuild
- `dist/extension.js` is the CommonJS extension-host output
- `dist/webview/main.js` and `dist/webview/main.css` are the browser-side outputs
- `.vscodeignore` excludes source, tests, scripts, maps, config files, and lockfiles from the packaged VSIX while keeping runtime assets such as `media/work-terminal-activity-bar.svg`

## Process spawning and security notes

This extension creates terminals and can launch external agent CLIs, so contributor docs need to stay precise here.

### What gets spawned

- Shell sessions use `vscode.window.createTerminal({ cwd, name })`
- Agent sessions use `vscode.window.createTerminal({ cwd, name, shellPath, shellArgs })`
- The extension does not invoke a shell to interpret a composed command string before launching an agent

### Command resolution

Configured agent commands are parsed by `src/agents/AgentLauncher.ts`.

- Commands are tokenized with quote-aware splitting so multi-token launch commands like `copilot chat` or `node ./tool.js` remain structured
- Absolute paths, relative path-like commands, and `PATH` lookups are supported
- Executables are validated before launch
- On Windows, executable resolution respects `PATHEXT`
- Extra arguments come from dedicated settings keys and are appended as explicit args, not via shell interpolation

### Context prompts

For `Claude (ctx)` and `Copilot (ctx)`, the work item context is not baked into the process command line. Instead, the extension sends a prompt into the terminal shortly after launch. That keeps launch argument handling simple while still giving the agent useful context.

### Agent state and rename tracking limits

VS Code does not expose raw terminal output streams or a first-class terminal rename event to extensions. Because of that, the board only shows best-effort session-state badges and rename updates when they can be inferred from host-visible signals such as terminal title changes, one-off interaction events, and extension-driven context prompts. Treat these badges as recent detectable signal state, not as exact live agent execution state.

### Webview safety

- `renderWorkTerminalHtml()` sets a restrictive Content Security Policy
- Webview scripts use a per-render nonce
- Bootstrapped JSON escapes `<`, `\u2028`, and `\u2029`
- `localResourceRoots` is limited to the built webview output directory
- User-facing strings rendered into HTML go through escaping helpers before insertion

### Filesystem behavior

- Work items are persisted inside the current workspace, not global extension storage
- Terminal session metadata is also persisted inside the current workspace for recovery-oriented relaunches
- Snapshot writes are atomic: write a temporary file, then rename into place
- Corrupt snapshots are renamed to `work-items.v1.json.corrupt-<timestamp>` before the store resets itself
- Corrupt terminal session snapshots are renamed to `terminal-sessions.v1.json.corrupt-<timestamp>` before the session store resets itself

## Settings

Current launch-related settings contributed by the extension:

- `workTerminal.agentProfiles` - optional full profile list for custom profiles, ordering, and built-in overrides
- `workTerminal.claudeCommand`
- `workTerminal.claudeExtraArgs`
- `workTerminal.copilotCommand`
- `workTerminal.copilotExtraArgs`
- `workTerminal.strandsCommand`
- `workTerminal.strandsExtraArgs`

If `workTerminal.agentProfiles` is unset, Work Terminal derives the built-in Claude, Copilot, and Strands profiles from the legacy command settings above. Once a profile list is saved from `Work Terminal: Manage Profiles`, that ordered list becomes the source of truth.

## Tests and validation

The current test suite covers the main documentation-sensitive behavior:

- `test/agents/AgentLauncher.test.ts` - command parsing and launch plan behavior
- `test/terminals/TerminalSessionStore.test.ts` - shell and agent session tracking plus recovery flows
- `test/terminals/TerminalSessionPersistence.test.ts` - terminal session persistence, deletion, and corrupt snapshot recovery
- `test/workItems/WorkItemStore.test.ts` - persistence, write serialization, and corrupt snapshot recovery
- `test/renderWorkTerminalHtml.test.ts` - HTML bootstrap and escaping
- `test/extensionManifest.test.ts` - activity bar icon and VSIX packaging guardrails

Run `pnpm check` before opening a PR. Run `pnpm package` when you need to verify the extension still packages cleanly.

## Contributor guidance

For a repo-specific maintainer and contributor playbook, see [`CLAUDE.md`](https://github.com/tomcorke/vscode-work-terminal-v3/blob/main/CLAUDE.md).

## License

MIT
