import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { initApi } from "./api";
import { CommandRegistry } from "./commands";
import { buildScript, findBundles, findManifests } from "./discovery";
import { SwiftScriptHost } from "./swiftHost";
import { loadBundle } from "./vswift";

let output: vscode.OutputChannel;
let hosts: SwiftScriptHost[] = [];
let commands: CommandRegistry;
let loading = false;

async function loadAll(context: vscode.ExtensionContext): Promise<void> {
  if (loading) return;
  loading = true;
  for (const h of hosts) h.dispose();
  hosts = [];
  const bundleCache = path.join(context.globalStorageUri.fsPath, "vswift-cache");
  try {
    const manifests = await findManifests(output);
    if (manifests.length === 0) {
      output.appendLine("[host] no source userscripts found (looked for userscript.json)");
    }
    for (const manifest of manifests) {
      try {
        const resolved = await buildScript(manifest, output);
        const host = new SwiftScriptHost(resolved, output, commands);
        await host.start();
        hosts.push(host);
        output.appendLine(`[host] started ${host.name}`);
      } catch (e) {
        output.appendLine(`[host] failed to start ${manifest.name}: ${e}`);
        vscode.window.showErrorMessage(`Swift userscript '${manifest.name}' failed: ${e}`);
      }
    }

    const installRoot = path.join(context.globalStorageUri.fsPath, "vswift-installed");
    const installed = fs.existsSync(installRoot)
      ? fs
          .readdirSync(installRoot)
          .filter((f) => f.endsWith(".vswift"))
          .map((f) => path.join(installRoot, f))
      : [];
    const bundles = [...new Set([...(await findBundles()), ...installed])];
    const seenBundles = new Set<string>();
    for (const bundlePath of bundles) {
      try {
        const loaded = loadBundle(bundlePath, bundleCache, (m) =>
          output.appendLine(`[vswift] ${m}`),
        );
        // The same bundle can be discovered twice (e.g. sitting in the
        // workspace AND installed). Skip duplicates so two hosts don't fight
        // over the same contributed command ids.
        const identity = `${loaded.manifest.name}@${loaded.manifest.version}`;
        if (seenBundles.has(identity)) {
          output.appendLine(
            `[vswift] skipping duplicate bundle ${identity} (${bundlePath})`,
          );
          continue;
        }
        seenBundles.add(identity);
        const host = new SwiftScriptHost(
          {
            manifest: {
              name: loaded.manifest.name,
              packagePath: loaded.extractDir,
              product: loaded.manifest.name,
            },
            binaryPath: loaded.binaryPath,
          },
          output,
          commands,
        );
        await host.start();
        hosts.push(host);
        output.appendLine(`[host] started ${loaded.manifest.name} (bundle)`);
      } catch (e) {
        output.appendLine(`[vswift] failed to load ${bundlePath}: ${e}`);
        vscode.window.showErrorMessage(`Failed to load .vswift bundle: ${e}`);
      }
    }
  } finally {
    loading = false;
  }
}

async function installBundle(context: vscode.ExtensionContext): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: "Install",
    filters: { "Swift Userscript bundle": ["vswift"] },
  });
  if (!picked?.length) return;
  const file = picked[0].fsPath;
  try {
    const installRoot = path.join(context.globalStorageUri.fsPath, "vswift-installed");
    fs.mkdirSync(installRoot, { recursive: true });
    // Persist the archive so the bundle reloads on future activations.
    const storedPath = path.join(installRoot, path.basename(file));
    fs.copyFileSync(file, storedPath);
    const loaded = loadBundle(storedPath, path.join(installRoot, "extracted"), (m) =>
      output.appendLine(`[install] ${m}`),
    );
    output.show(true);
    output.appendLine(`[install] installed ${loaded.manifest.name} ${loaded.manifest.version}`);
    vscode.window.showInformationMessage(
      `Installed ${loaded.manifest.name} ${loaded.manifest.version}`,
    );
    await loadAll(context);
  } catch (e) {
    output.appendLine(`[install] rejected ${file}: ${e}`);
    vscode.window.showErrorMessage(`Invalid .vswift bundle: ${e}`);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel("Swift Userscripts");
  commands = new CommandRegistry(vscode.commands.registerCommand);
  context.subscriptions.push(output, commands);
  initApi(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("swiftUserscripts.reload", () => loadAll(context)),
    vscode.commands.registerCommand("swiftUserscripts.showLog", () => output.show()),
    vscode.commands.registerCommand("swiftUserscripts.installVswift", () =>
      installBundle(context),
    ),
  );

  await loadAll(context);

  const watcher = vscode.workspace.createFileSystemWatcher("**/userscript.json");
  const bundleWatcher = vscode.workspace.createFileSystemWatcher("**/*.vswift");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(() => loadAll(context)),
    watcher.onDidChange(() => loadAll(context)),
    watcher.onDidDelete(() => loadAll(context)),
    bundleWatcher,
    bundleWatcher.onDidCreate(() => loadAll(context)),
    bundleWatcher.onDidChange(() => loadAll(context)),
    bundleWatcher.onDidDelete(() => loadAll(context)),
  );
}

export function deactivate(): void {
  for (const h of hosts) h.dispose();
  hosts = [];
  commands?.dispose();
}
