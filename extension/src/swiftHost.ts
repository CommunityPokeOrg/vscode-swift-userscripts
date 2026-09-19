// Host side of a single Swift userscript: spawns the compiled binary,
// performs the initialize handshake, registers its contributed commands,
// and routes vscode API requests coming back from the script.

import * as cp from "child_process";
import * as vscode from "vscode";
import { apiHandlers } from "./api";
import { CommandRegistry } from "./commands";
import { ResolvedScript } from "./discovery";
import { Json, RpcPeer } from "./rpc";

interface ScriptManifest {
  name: string;
  version?: string;
  contributes?: {
    commands?: { id: string; title: string }[];
  };
}

export class SwiftScriptHost implements vscode.Disposable {
  private proc: cp.ChildProcess | undefined;
  private peer: RpcPeer | undefined;

  constructor(
    private readonly script: ResolvedScript,
    private readonly output: vscode.OutputChannel,
    private readonly commands: CommandRegistry,
  ) {}

  get name(): string {
    return this.script.manifest.name;
  }

  /** Command contributions reported by the script's initialize manifest. */
  contributedCommands: { id: string; title: string }[] = [];

  /** Distinct owner key for command registrations (binary path is unique per load source). */
  private get ownerKey(): string {
    return `${this.script.manifest.name}@${this.script.binaryPath}`;
  }

  async start(): Promise<void> {
    this.proc = cp.spawn(this.script.binaryPath, ["--stdio"], {
      cwd: this.script.manifest.packagePath,
      stdio: ["pipe", "pipe", "inherit"],
    });
    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error(`failed to spawn ${this.script.binaryPath}`);
    }
    this.peer = new RpcPeer(this.proc.stdout, this.proc.stdin, (m) =>
      this.output.appendLine(`[rpc ${this.name}] ${m}`),
    );

    // API surface the script may call.
    for (const [method, handler] of Object.entries(apiHandlers)) {
      this.peer.onRequest(method, (params) => handler(params));
    }
    this.peer.onNotification("vscode/log", (p) =>
      this.output.appendLine(`[${this.name}] ${JSON.stringify((p as any)?.message ?? p)}`),
    );
    this.proc.on("exit", (code) => {
      this.output.appendLine(`[${this.name}] exited with code ${code}`);
      this.dispose();
    });

    const result = (await this.peer.sendRequest("initialize", {
      pid: process.pid,
      workspaceFolders:
        vscode.workspace.workspaceFolders?.map((f) => f.uri.toString()) ?? [],
      capabilities: { api: Object.keys(apiHandlers) },
    })) as unknown as ScriptManifest;

    this.contributedCommands = result.contributes?.commands ?? [];
    // Clear any registrations this host may have left from a prior start()
    // (e.g. a start that threw partway through registration).
    this.commands.unregisterOwner(this.ownerKey);
    try {
      for (const cmd of this.contributedCommands) {
        this.output.appendLine(`[${this.name}] registering command ${cmd.id}`);
        this.commands.registerFor(this.ownerKey, cmd.id, async (...args) => {
          return await this.peer!.sendRequest("workspace/executeCommand", {
            command: cmd.id,
            arguments: args as Json[],
          });
        });
      }
    } catch (e) {
      // Don't leak partial registrations from a failed start.
      this.commands.unregisterOwner(this.ownerKey);
      throw e;
    }
  }

  dispose(): void {
    this.commands.unregisterOwner(this.ownerKey);
    try {
      this.peer?.sendNotification("shutdown");
    } catch {
      /* process may already be gone */
    }
    this.proc?.kill();
    this.proc = undefined;
  }
}
