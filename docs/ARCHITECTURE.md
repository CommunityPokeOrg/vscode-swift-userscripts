# Architecture

## Goal

Let extension developers write VS Code features (commands, UI interactions,
editor/workspace operations) in **Swift**, distributed as lightweight
"userscripts", without forking VS Code or rebuilding its Electron shell.

## Options considered

### 1. Host extension + Swift subprocesses (chosen MVP)

A normal extension discovers script manifests, builds each script with SwiftPM,
spawns the binary, and proxies `vscode` API calls over stdio JSON-RPC.

- ✅ No fork; installs in stock VS Code/VSCodium/Cursor; ships via `vsce`
- ✅ Native Swift performance; real Foundation/SPM dependencies allowed
- ✅ Crash isolation — a panicking script can't wedge the extension host
- ✅ Testable headlessly (the protocol is just NDJSON over pipes)
- ⚠️ API surface must be proxied method-by-method (can't hand Swift the real
  `vscode` object); async UI calls cost an IPC round-trip
- ⚠️ Scripts are full-power native processes — no sandboxing

### 2. Fork vscode with a native Swift extension host

Add a third extension-host kind (alongside Node.js and WebWorker) that loads
Swift bundles in-process.

- ❌ Requires maintaining a fork of the ~10 GB Electron tree and rebuilding the
  workbench — explicitly ruled out by requirements
- ❌ Distribution nightmare: every user needs the forked editor
- ✅ Deepest possible API access — but unnecessary for a userscript system

### 3. Swift → WebAssembly in the web extension host

Compile scripts with SwiftWasm and run them in the browser-worker extension
host (works even on vscode.dev).

- ✅ True sandboxing for free (WASM), cross-platform without per-OS binaries
- ❌ SwiftWasm toolchain immaturity; Foundation support is partial
- ❌ Web extensions can't spawn processes or touch the filesystem natively —
  a poor fit for "extension features" that need real system access
- Worth revisiting later as an *optional* sandboxed tier.

### 4. N-API / node-gyp native addon embedding Swift

Compile Swift into a `.node` addon loaded by the extension.

- ❌ node-gyp ABI pain; a crash takes down the extension host
- ❌ Complicates debugging and distribution (per-Node-ABI builds)
- Only interesting if IPC overhead ever becomes the bottleneck.

## Protocol

Newline-delimited JSON-RPC 2.0 over stdio — see [PROTOCOL.md](PROTOCOL.md).

Lifecycle:

1. **Discovery** — host finds `**/userscript.json` (`{name, product, packagePath}`)
2. **Build** — `swift build -c <debug|release> --product <product>`
3. **Spawn** — binary started with stdio pipes
4. **Initialize** — host→script `initialize` request; script replies with its
   declared manifest (`contributes.commands`, …)
5. **Registration** — host registers declared commands via
   `vscode.commands.registerCommand`
6. **Invocation** — host→script `workspace/executeCommand`; script may make
   re-entrant `vscode/*` calls back to the host during handling
7. **Shutdown** — host sends `shutdown` notification / closes stdin

Both directions are symmetric requests — a script command handler can
`await vscode.window.showInputBox(...)` mid-command.

## API surface (v0)

Methods implemented in `extension/src/api.ts` and mirrored in
`Sources/SwiftUserscript/VSCode.swift`:

| RPC method | Swift call |
| --- | --- |
| `vscode/window.showInformationMessage` | `vscode.window.showInformationMessage(_:)` |
| `vscode/window.showWarningMessage` | — |
| `vscode/window.showErrorMessage` | `vscode.window.showErrorMessage(_:)` |
| `vscode/window.showInputBox` | `vscode.window.showInputBox(prompt:)` |
| `vscode/window.showQuickPick` | `vscode.window.showQuickPick(_:)` |
| `vscode/window.activeTextEditor` | `vscode.window.activeTextEditor()` |
| `vscode/workspace.openTextDocument` (uri or `{content, language}`) | — |
| `vscode/window.showTextDocument` | — |
| `vscode/window.showUntitledDocument` | `vscode.window.showUntitledDocument(content:)` |
| `vscode/editor.insertOrReplaceSelection` | `vscode.editor.insertOrReplaceSelection(_:)` |
| `vscode/editor.documentText` | `vscode.editor.documentText()` |
| `vscode/env.clipboardReadText` | `vscode.env.clipboardReadText()` |
| `vscode/env.clipboardWriteText` | `vscode.env.clipboardWriteText(_:)` |
| `vscode/statusBar.setText` | — |
| `vscode/log` (notification) | `vscode.log(_:)` |

Adding an API = one entry in `api.ts` + one wrapper in `VSCode.swift`.

## Security model

- Scripts are native processes with user privileges — **no sandbox today**.
- The API surface is allowlisted in `api.ts`: scripts can't reach arbitrary
  `vscode` internals.
- Roadmap hardening: per-script API allowlists in `userscript.json`,
  `sandbox-exec` (macOS) / `bwrap` (Linux) launch wrappers, signed manifests.

## Next steps

- [ ] Package extension as `.vsix` (`vsce package`) and dogfood in real VS Code
- [ ] Workspace edits (`vscode/workspace.applyEdit`), events (onDidSave, onDidOpen)
- [ ] `swiftuserscripts watch` mode: rebuild on `.swift` file change
- [ ] Single-file script support via `swift-sh`-style shims or cached `swiftc`
- [ ] Error surfacing: script stderr → Problems/output channel diagnostics
- [ ] Optional WASM tier for untrusted scripts
