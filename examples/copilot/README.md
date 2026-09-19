# copilot-userscript

A Copilot-*style* AI coding userscript written in Swift against the
`SwiftUserscript` SDK.

**Honest scope:** this is a **command-based** MVP, not true inline completion.
Real GitHub Copilot works via `InlineCompletionItemProvider` "ghost text"
(suggestions rendered inline as you type). The userscript host API does not
expose inline-completion providers yet, so this example delivers the feasible
subset — editor-context-aware commands — and documents the gap. There is also
**no GitHub Copilot integration**: it calls a generic OpenAI-compatible
chat-completions endpoint you configure yourself.

## Commands

| Command ID | Palette title | What it does |
| --- | --- | --- |
| `swiftCopilot.generate` | Swift Copilot: Generate Code | Prompts for a description → generates code → **inserts at cursor / replaces selection** |
| `swiftCopilot.explain` | Swift Copilot: Explain Selection | Explains the selection (or whole file) → opens result in a markdown scratch doc |
| `swiftCopilot.refactor` | Swift Copilot: Refactor Selection | Prompts for an instruction → rewrites the **selection in place** |

## Configuration

The script reads its LLM endpoint from environment variables of the userscript
process (it inherits VS Code's environment — set them in the shell you launch
`code` from, or your shell profile). Nothing is hardcoded; no key is required
for local endpoints.

| Variable | Default | Notes |
| --- | --- | --- |
| `SWIFT_LLM_BASE_URL` | `http://localhost:11434/v1` | Any OpenAI-compatible server: Ollama, LM Studio, vLLM, `https://api.openai.com/v1`, Azure, … |
| `SWIFT_LLM_MODEL` | `qwen2.5-coder` | Whatever model name the endpoint expects |
| `SWIFT_LLM_API_KEY` | *(unset)* | Optional `Authorization: Bearer` token |

Example — point at OpenAI:

```sh
export SWIFT_LLM_BASE_URL=https://api.openai.com/v1
export SWIFT_LLM_API_KEY=sk-...
export SWIFT_LLM_MODEL=gpt-4o-mini
code .
```

Example — local Ollama (default base URL already matches):

```sh
ollama pull qwen2.5-coder && ollama serve
export SWIFT_LLM_MODEL=qwen2.5-coder
code .
```

## Layout

- `Sources/CopilotCore/LLMClient.swift` — OpenAI-compatible client on
  `URLSession`, transport-injectable for tests, `stripCodeFences` post-pass.
- `Sources/CopilotUserscript/main.swift` — manifest + command handlers.
- `Tests/CopilotCoreTests/` — offline unit tests (response parsing, request
  shape incl. auth header, non-2xx errors, fence stripping, env config).

## Host API used

`window.showInputBox`, `window.activeTextEditor`, `window.showInformationMessage`,
`window.showErrorMessage`, `window.showUntitledDocument`,
`editor.insertOrReplaceSelection`, `editor.documentText` — see
`extension/src/api.ts` for the allowlist.
