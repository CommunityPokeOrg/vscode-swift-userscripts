// Pure helpers for the "Run Script Command" QuickPick — vscode-free so tests
// can exercise them in plain node.

export interface RegisteredCommand {
  id: string;
  owner: string; // e.g. "copilot-userscript@/path/to/binary"
}

export interface HostCommands {
  name: string; // script manifest name
  commands: { id: string; title: string }[];
}

export interface CommandPickItem {
  label: string;
  description: string;
  detail: string;
  commandId: string;
}

/** Build QuickPick items from live registrations + per-host manifest titles. */
export function toPickItems(
  registered: RegisteredCommand[],
  hosts: HostCommands[],
): CommandPickItem[] {
  const titleOf = new Map<string, { title: string; script: string }>();
  for (const h of hosts) {
    for (const c of h.commands) titleOf.set(c.id, { title: c.title, script: h.name });
  }
  return registered
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => {
      const meta = titleOf.get(r.id);
      const scriptName = r.owner.split("@")[0];
      return {
        label: meta?.title ?? r.id,
        description: r.id,
        detail: `from ${meta?.script ?? scriptName}`,
        commandId: r.id,
      };
    });
}
