// Shared registry for commands contributed by userscripts. Command IDs are
// global to VS Code, so a script reloading (or the same bundle discovered via
// two sources) would otherwise collide with its own previous registrations.

import * as vscode from "vscode";

export type RegisterCommand = (
  id: string,
  callback: (...args: unknown[]) => unknown,
) => vscode.Disposable;

export class CommandRegistry implements vscode.Disposable {
  /** command id -> live Disposable */
  private byId = new Map<string, vscode.Disposable>();
  /** host/script id -> command ids it registered */
  private byOwner = new Map<string, Set<string>>();

  constructor(private readonly register: RegisterCommand) {}

  /** Idempotent: replaces any existing registration for `id`. */
  registerFor(owner: string, id: string, callback: (...args: unknown[]) => unknown): void {
    this.unregisterId(id);
    let disposable: vscode.Disposable;
    try {
      disposable = this.register(id, callback);
    } catch (e) {
      // Another extension may own this id; surface a clear error instead of
      // letting a raw "already exists" crash the bundle load.
      throw new Error(`cannot register command '${id}': ${e}`);
    }
    this.byId.set(id, disposable);
    let owned = this.byOwner.get(owner);
    if (!owned) {
      owned = new Set();
      this.byOwner.set(owner, owned);
    }
    owned.add(id);
  }

  unregisterId(id: string): void {
    const d = this.byId.get(id);
    if (d) {
      this.byId.delete(id);
      try {
        d.dispose();
      } catch {
        /* already disposed */
      }
    }
  }

  /** Disposes every command registered by `owner` (stop/remove/deactivate). */
  unregisterOwner(owner: string): void {
    const owned = this.byOwner.get(owner);
    if (!owned) return;
    this.byOwner.delete(owner);
    for (const id of owned) this.unregisterId(id);
  }

  isRegistered(id: string): boolean {
    return this.byId.has(id);
  }

  dispose(): void {
    for (const id of [...this.byId.keys()]) this.unregisterId(id);
    this.byOwner.clear();
  }
}
