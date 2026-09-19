# Protocol

Newline-delimited JSON-RPC 2.0 over stdio. Every message is a single JSON
value terminated by `\n` (JSON.stringify / JSONEncoder escape embedded
newlines, so framing is unambiguous). stderr is reserved for human-readable
script diagnostics; the host pipes it to its own stderr.

Both sides may send requests, responses, and notifications at any time after
spawn.

## Host → Script

### `initialize` (request)

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "pid": 1234,
  "workspaceFolders": ["file:///home/me/project"],
  "capabilities": {"api": ["vscode/window.showInformationMessage", "..."]}
}}
```

Reply — the script's manifest:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "name":"hello-userscript","version":"0.1.0",
  "contributes":{"commands":[{"id":"swiftHello.sayHello","title":"Swift: Say Hello"}]}
}}
```

### `workspace/executeCommand` (request)

```json
{"jsonrpc":"2.0","id":2,"method":"workspace/executeCommand",
 "params":{"command":"swiftHello.sayHello","arguments":[]}}
```

Result: any JSON value; surfaced as the command's return value.

### `shutdown` (notification)

Host is unloading the script. The script should exit; the host also closes
stdin and SIGKILLs after a grace period.

## Script → Host

`vscode/<module>.<method>` requests dispatch into the real `vscode` API
(allowlist in `extension/src/api.ts`). Examples:

```json
{"jsonrpc":"2.0","id":1,"method":"vscode/window.showInformationMessage",
 "params":{"message":"hi","items":["a","b"]}}
```

```json
{"jsonrpc":"2.0","id":2,"method":"vscode/window.activeTextEditor"}
```

### `vscode/log` (notification)

`{"message": "..."}` — appended to the host's output channel.

## Errors

Standard JSON-RPC errors: `-32601` method not found (call to a `vscode/*`
method the host doesn't expose or an unhandled command), `-32603` handler
threw. Unknown command IDs passed to `workspace/executeCommand` return
`-32603` with `unknownCommand` in the message.
