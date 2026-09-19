# Swift Userscripts

Run VS Code extension features written in **Swift**. This extension discovers
`userscript.json` manifests in the workspace, builds each SwiftPM script,
spawns it, and bridges a curated subset of the `vscode` API over stdio
JSON-RPC.

Commands:

- **Swift Userscripts: Reload Scripts** — rescan, rebuild, and respawn
- **Swift Userscripts: Show Log** — open the bridge output channel

Script API surface (v0): `window.showInformationMessage` /
`showWarningMessage` / `showErrorMessage`, `showInputBox`, `showQuickPick`,
`activeTextEditor`, `workspace.openTextDocument`, `showTextDocument`,
`env.clipboardReadText`/`clipboardWriteText`, `statusBar.setText`, `log`.

Docs, the `SwiftUserscript` SwiftPM kit, and an example userscript live at
https://github.com/CommunityPokeOrg/vscode-swift-userscripts

**Security:** userscripts are unsandboxed native processes — only install
scripts you trust.
