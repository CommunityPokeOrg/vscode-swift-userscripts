// Host side of a single Swift userscript: spawns the compiled binary,
// performs the initialize handshake, registers its contributed commands,
// and routes vscode API requests coming back from the script.

import * as cp from "child_process";
import * as vscode from "vscode";
import { apiHandlers } from "./api";
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
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly script: ResolvedScript,
    private readonly output: vscode.OutputChannel,
  ) {}

  get name(): string {
    return this.script.manifest.name;
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

    for (const cmd of result.contributes?.commands ?? []) {
      this.output.appendLine(`[${this.name}] registering command ${cmd.id}`);
      this.disposables.push(
        vscode.commands.registerCommand(cmd.id, async (...args) => {
          return await this.peer!.sendRequest("workspace/executeCommand", {
            command: cmd.id,
            arguments: args as Json[],
          });
        }),
      );
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    try {
      this.peer?.sendNotification("shutdown");
    } catch {
      /* process may already be gone */
    }
    this.proc?.kill();
    this.proc = undefined;
  }
}
