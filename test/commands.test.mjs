// Regression tests for CommandRegistry — command-id collisions crashed bundle
// loading with "command 'x' already exists" (e.g. copilot.vswift discovered in
// the workspace AND installed). Runs against the compiled extension output.

import assert from "node:assert/strict";
import { CommandRegistry } from "../extension/out/commands.js";

let passed = 0;
function ok(name, cond = true) {
  assert.ok(cond, name);
  passed++;
  console.log(`ok: ${name}`);
}

// Fake vscode.commands: registerCommand throws when the id is already live,
// exactly like real VS Code.
function makeVscode() {
  const live = new Map();
  return {
    live,
    registerCommand: (id, cb) => {
      if (live.has(id)) {
        throw new Error(`command '${id}' already exists`);
      }
      live.set(id, cb);
      return { dispose: () => live.delete(id) };
    },
  };
}

const vscode = makeVscode();
const reg = new CommandRegistry(vscode.registerCommand);

// Repeated load: same owner re-registers same ids — must not throw.
reg.registerFor("copilot@bin/1", "swiftCopilot.generate", () => {});
reg.registerFor("copilot@bin/1", "swiftCopilot.explain", () => {});
ok("owner registers two commands");
reg.registerFor("copilot@bin/1", "swiftCopilot.generate", () => {});
ok("re-register same owner/id is idempotent (no throw)");
ok("command still live after re-register", vscode.live.has("swiftCopilot.generate"));

// Second host (duplicate bundle source) takes over the id instead of crashing.
reg.registerFor("copilot@bin/2", "swiftCopilot.generate", () => {});
ok("second owner replaces same command id");
ok("exactly one live registration", vscode.live.size === 2);

// Owner cleanup frees ids for reuse.
reg.unregisterOwner("copilot@bin/2");
ok("unregisterOwner frees command", !vscode.live.has("swiftCopilot.generate"));
reg.registerFor("copilot@bin/3", "swiftCopilot.generate", () => {});
ok("command re-registrable after owner cleanup");

// Failed owner cleanup path: partial start is rolled back by host; registry
// level check — unregisterOwner removes all of an owner's ids.
reg.registerFor("copilot@bin/3", "swiftCopilot.refactor", () => {});
reg.unregisterOwner("copilot@bin/3");
ok("all owner ids removed", !vscode.live.has("swiftCopilot.refactor"));

// Stale ids from other owners are left alone.
ok("other owner untouched", vscode.live.has("swiftCopilot.explain"));

// Deactivate/dispose clears everything.
reg.dispose();
ok("dispose clears all registrations", vscode.live.size === 0);

// Double dispose is safe.
reg.dispose();
ok("double dispose is safe");

// Disposing a disposable twice (registry + vscode) doesn't throw.
reg.registerFor("a", "x", () => {});
reg.unregisterId("x");
reg.unregisterId("x");
ok("unregisterId idempotent");

console.log(`commands: all ${passed} checks passed`);
