# vscode-swift-userscripts

Run **VS Code extension features written in Swift** — without forking VS Code.

A conventional VS Code extension (the *host*) discovers Swift "userscripts" in
your workspace, compiles them with SwiftPM, spawns each as a child process, and
bridges a curated subset of the `vscode` API over newline-delimited JSON-RPC on
stdio. Swift code gets real editor superpowers — commands, messages, input
boxes, editor state — while staying in its own native process.

```
┌──────────── VS Code ────────────┐
│  extension/ (TypeScript host)   │
│   discovery → swift build       │
│   spawn ──── NDJSON/JSON-RPC ───┼──► swift-userscript binary
│   vscode API dispatch      ◄────┼──── vscode/* requests
└─────────────────────────────────┘
```

## Why not a VS Code fork?

The extension host already runs all extension code out-of-process and lets any
extension spawn subprocesses — the exact mechanism LSP servers use. A fork of
`microsoft/vscode` (~10 GB Electron tree) would only be needed to change the
extension-host runtime itself; for adding a *new language* for extension
features, a host extension is strictly smaller, works in stock VS Code /
VSCodium / Cursor, and ships through the normal extension tooling (`vsce`).
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full options analysis.

## Layout

| Path | What |
| --- | --- |
| `extension/` | The VS Code host extension (TypeScript) |
| `swift-userscript/` | `SwiftUserscript` — SwiftPM library scripts import |
| `examples/hello/` | Minimal example userscript (SwiftPM executable + `userscript.json`) |
| `examples/copilot/` | Copilot-style AI commands (Generate/Explain/Refactor) over a configurable OpenAI-compatible endpoint |
| `docs/` | Architecture & protocol docs |
| `test/smoke.mjs` | End-to-end protocol test without VS Code |
| `test/vswift.test.mjs` | `.vswift` bundle tests (pack, extract, defenses) |
| `docs/VSWIFT.md` | `.vswift` bundle format spec |

## Quick start

Requirements: Node ≥ 18, Swift ≥ 5.9 toolchain (`swift` on PATH), VS Code.

```sh
# 1. Build the Swift example
cd examples/hello && swift build        # produces .build/debug/HelloUserscript

# 2. Build the extension
cd ../../extension && npm install && npm run compile

# 3. Launch the Extension Development Host
code --extensionDevelopmentPath=$PWD --new-window /path/to/a/workspace
#    put a userscript.json-bearing folder in that workspace, then:
#    Command Palette → "Swift: Say Hello"
```

## Writing a userscript

A userscript is a tiny SwiftPM executable package plus a `userscript.json`
manifest. See `examples/hello` — the whole script is:

```swift
import SwiftUserscript

let vscode = VSCode()
try await vscode.start(
    manifest: UserscriptManifest(name: "my-script", version: "0.1.0", commands: [
        CommandContribution(id: "my.hello", title: "My: Hello"),
    ])
) { command, _ in
    if command == "my.hello" {
        try await vscode.window.showInformationMessage("hi from swift")
    }
    return nil
}
```

`userscript.json`:

```json
{ "name": "my-script", "product": "MyScript", "packagePath": "." }
```

The host watches `**/userscript.json`, builds with `swift build`, and hot-reloads.

## `.vswift` bundles (no toolchain needed to *run* a script)

Pack a compiled script into a shareable archive and load it directly:

```sh
cd swift-userscript && swift build --product vswift   # build the packager
./.build/debug/vswift pack ../examples/hello --product HelloUserscript -o hello.vswift
```

Drop `hello.vswift` in the workspace (auto-discovered via `**/*.vswift`) or use
**"Swift Userscripts: Install .vswift Bundle"**. Format spec: [docs/VSWIFT.md](docs/VSWIFT.md).

## Security model

Userscripts are **native processes** — they have the full privileges of your
user account. There is no sandbox. They can only touch the editor through the
explicit `vscode/*` methods listed in `extension/src/api.ts`, but nothing stops
a script from reading files or making network calls directly. Treat userscripts
like any executable you install. Hardening options (sandbox-exec on macOS,
Linux namespaces, an opt-in API allowlist per script) are discussed in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributors

- [WolfyBlair](https://github.com/WolfyBlair)

## Status

Working scaffold: discovery → build → spawn → handshake → command registration
→ bidirectional API calls, plus a headless protocol smoke test
(`node test/smoke.mjs`). Not yet inside a packaged `.vsix`. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#next-steps) for the roadmap.
