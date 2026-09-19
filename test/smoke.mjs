#!/usr/bin/env node
// Protocol smoke test: spawns a compiled userscript binary and exercises the
// JSON-RPC bridge without VS Code.
//
// Usage: node test/smoke.mjs [path-to-userscript-binary]
//   default binary: examples/hello/.build/debug/HelloUserscript
//
// Checks:
//   1. script sends 'initialize' -> responds with its manifest
//   2. host sends 'workspace/executeCommand' -> script calls back
//      'vscode/window.showInformationMessage' -> host answers -> command returns
//   3. unknown command surfaces an RPC error
//   4. stdin close -> process exits

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin =
  process.argv[2] ?? path.join(root, "examples/hello/.build/debug/HelloUserscript");

const proc = spawn(bin, ["--stdio"], { stdio: ["pipe", "pipe", "inherit"] });

let buffer = "";
const pending = new Map();
const received = [];
let nextId = 1;
const hostCalls = [];

proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    handle(JSON.parse(line));
  }
});

function send(msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function handle(msg) {
  received.push(msg);
  if (msg.id !== undefined && msg.method !== undefined) {
    // Request from the script: emulate the vscode API surface.
    hostCalls.push(msg.method);
    if (msg.method === "vscode/window.showInformationMessage") {
      send({ jsonrpc: "2.0", id: msg.id, result: null });
    } else if (msg.method === "vscode/window.activeTextEditor") {
      send({ jsonrpc: "2.0", id: msg.id, result: null });
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `unmocked: ${msg.method}` },
      });
    }
  } else if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
  }
}

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

const apiCaps = {
  api: [
    "vscode/window.showInformationMessage",
    "vscode/window.showErrorMessage",
    "vscode/window.showInputBox",
    "vscode/window.showQuickPick",
    "vscode/window.activeTextEditor",
    "vscode/env.clipboardReadText",
    "vscode/env.clipboardWriteText",
  ],
};

const manifest = await request("initialize", {
  pid: process.pid,
  workspaceFolders: [],
  capabilities: apiCaps,
});
assert(manifest?.name === "hello-userscript", "initialize returns script manifest");
assert(
  manifest?.contributes?.commands?.length === 3,
  "manifest declares 3 commands",
);

const result = await request("workspace/executeCommand", {
  command: "swiftHello.sayHello",
  arguments: [],
});
assert(result === null, "executeCommand(swiftHello.sayHello) returns null");
assert(
  hostCalls.includes("vscode/window.showInformationMessage"),
  "script called window.showInformationMessage on the host",
);

await request("workspace/executeCommand", {
  command: "does.not.exist",
  arguments: [],
}).then(
  () => assert(false, "unknown command should error"),
  (e) => assert(!!e, "unknown command surfaces RPC error"),
);

const exited = new Promise((r) => proc.on("exit", r));
proc.stdin.end();
const code = await exited;
assert(code === 0, `process exits cleanly on stdin close (code=${code})`);

console.log("smoke: all checks passed");
