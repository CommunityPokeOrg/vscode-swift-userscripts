// Regression tests for CommandRegistry — command-id collisions crashed bundle
// loading with "command 'x' already exists" (e.g. copilot.vswift discovered in
// the workspace AND installed). Runs against the compiled extension output.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommandRegistry } from "../extension/out/commands.js";
import { toPickItems } from "../extension/out/commandPalette.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

// --- Command palette contributions (package.json) ---
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "extension/package.json"), "utf8"),
);
const contributed = pkg.contributes.commands.map((c) => c.command);
ok(
  "runCommand contributed",
  contributed.includes("swiftUserscripts.runCommand"),
);
for (const id of ["swiftCopilot.generate", "swiftCopilot.explain", "swiftCopilot.refactor"]) {
  const c = pkg.contributes.commands.find((x) => x.command === id);
  ok(`${id} contributed with category`, c?.category === "Swift Copilot");
}
ok(
  "copilot commands gated on swiftCopilot.loaded context",
  pkg.contributes.menus?.commandPalette?.every(
    (m) => !m.command.startsWith("swiftCopilot.") || m.when === "swiftCopilot.loaded",
  ),
);

// --- registry list() metadata + QuickPick items ---
const reg2 = new CommandRegistry(makeVscode().registerCommand);
const vsc2 = makeVscode();
const reg3 = new CommandRegistry(vsc2.registerCommand);
reg3.registerFor("copilot-userscript@/bin/a", "swiftCopilot.generate", () => {});
reg3.registerFor("copilot-userscript@/bin/a", "swiftCopilot.explain", () => {});
reg3.registerFor("hello-userscript@/bin/b", "swiftHello.sayHello", () => {});
const listed = reg3.list();
ok("list() returns all live registrations", listed.length === 3);
ok(
  "list() exposes owner metadata",
  listed.find((x) => x.id === "swiftCopilot.generate")?.owner ===
    "copilot-userscript@/bin/a",
);

const items = toPickItems(reg3.list(), [
  {
    name: "copilot-userscript",
    commands: [
      { id: "swiftCopilot.generate", title: "Generate Code" },
      { id: "swiftCopilot.explain", title: "Explain Selection" },
    ],
  },
  { name: "hello-userscript", commands: [{ id: "swiftHello.sayHello", title: "Say Hello" }] },
]);
ok("pick items sorted by command id", items[0].commandId === "swiftCopilot.explain");
ok(
  "pick item shows manifest title + owner",
  items[1].label === "Generate Code" &&
    items[1].description === "swiftCopilot.generate" &&
    items[1].detail === "from copilot-userscript",
);
// Cleanup removes entries from future listings.
reg3.unregisterOwner("copilot-userscript@/bin/a");
ok(
  "cleanup shrinks list()",
  reg3.list().length === 1 && reg3.list()[0].id === "swiftHello.sayHello",
);
ok(
  "pick items after cleanup only list live commands",
  toPickItems(reg3.list(), []).length === 1,
);

console.log(`commands: all ${passed} checks passed`);
