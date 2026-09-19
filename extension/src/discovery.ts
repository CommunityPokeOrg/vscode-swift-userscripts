// Discovers userscript manifests (userscript.json) in the workspace and
// resolves each to an executable binary, building with SwiftPM when needed.

import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export interface UserscriptManifest {
  /** Display name of the script. */
  name: string;
  /** Directory containing the script's Package.swift (SwiftPM executable package). */
  packagePath: string;
  /** SwiftPM product/executable target name to build and run. */
  product: string;
}

export interface ResolvedScript {
  manifest: UserscriptManifest;
  binaryPath: string;
}

export async function findManifests(
  output: vscode.OutputChannel,
): Promise<UserscriptManifest[]> {
  const glob = vscode.workspace
    .getConfiguration("swiftUserscripts")
    .get<string>("scriptGlob", "**/userscript.json");
  const files = await vscode.workspace.findFiles(glob, "**/node_modules/**");
  const manifests: UserscriptManifest[] = [];
  for (const uri of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(uri.fsPath, "utf8"));
      const dir = path.dirname(uri.fsPath);
      manifests.push({
        name: raw.name ?? path.basename(dir),
        packagePath: raw.packagePath ? path.resolve(dir, raw.packagePath) : dir,
        product: raw.product ?? raw.name ?? path.basename(dir),
      });
    } catch (e) {
      output.appendLine(`[discover] skipping ${uri.fsPath}: ${e}`);
    }
  }
  return manifests;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { cwd });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err}`)),
    );
    p.on("error", reject);
  });
}

/** `swift build` the package and return the produced executable's path. */
export async function buildScript(
  manifest: UserscriptManifest,
  output: vscode.OutputChannel,
): Promise<ResolvedScript> {
  const config = vscode.workspace
    .getConfiguration("swiftUserscripts")
    .get<string>("buildConfiguration", "debug");
  output.appendLine(
    `[build] ${manifest.name}: swift build -c ${config} --product ${manifest.product} (in ${manifest.packagePath})`,
  );
  await run("swift", ["build", "-c", config, "--product", manifest.product], manifest.packagePath);
  const binaryPath = path.join(manifest.packagePath, ".build", config, manifest.product);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`build succeeded but binary not found at ${binaryPath}`);
  }
  return { manifest, binaryPath };
}
