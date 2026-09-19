import * as vscode from "vscode";
import { initApi } from "./api";
import { buildScript, findManifests } from "./discovery";
import { SwiftScriptHost } from "./swiftHost";

let output: vscode.OutputChannel;
let hosts: SwiftScriptHost[] = [];
let loading = false;

async function loadAll(context: vscode.ExtensionContext): Promise<void> {
  if (loading) return;
  loading = true;
  for (const h of hosts) h.dispose();
  hosts = [];
  try {
    const manifests = await findManifests(output);
    if (manifests.length === 0) {
      output.appendLine("[host] no userscripts found (looked for userscript.json)");
    }
    for (const manifest of manifests) {
      try {
        const resolved = await buildScript(manifest, output);
        const host = new SwiftScriptHost(resolved, output);
        await host.start();
        hosts.push(host);
        output.appendLine(`[host] started ${host.name}`);
      } catch (e) {
        output.appendLine(`[host] failed to start ${manifest.name}: ${e}`);
        vscode.window.showErrorMessage(`Swift userscript '${manifest.name}' failed: ${e}`);
      }
    }
  } finally {
    loading = false;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Swift Userscripts");
  context.subscriptions.push(output);
  initApi(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("swiftUserscripts.reload", () => loadAll(context)),
    vscode.commands.registerCommand("swiftUserscripts.showLog", () => output.show()),
  );

  await loadAll(context);

  const watcher = vscode.workspace.createFileSystemWatcher("**/userscript.json");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => loadAll(context)),
    watcher.onDidChange(() => loadAll(context)),
    watcher.onDidDelete(() => loadAll(context)),
  );
}

export function deactivate(): void {
  for (const h of hosts) h.dispose();
  hosts = [];
}
