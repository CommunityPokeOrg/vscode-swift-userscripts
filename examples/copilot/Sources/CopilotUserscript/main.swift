import CopilotCore
import Foundation
import SwiftUserscript

let vscode = VSCode()
let llm = LLMClient()  // SWIFT_LLM_BASE_URL / SWIFT_LLM_API_KEY / SWIFT_LLM_MODEL

/// Editor context: selection if present, else nil (callers decide fallbacks).
func selectionContext() async throws -> (editor: ActiveTextEditor, text: String)? {
    guard let editor = try await vscode.window.activeTextEditor() else { return nil }
    guard let text = editor.selectedText, !text.isEmpty else {
        return (editor, "")
    }
    return (editor, text)
}

func reportError(_ prefix: String, _ error: Error) async {
    try? await vscode.window.showErrorMessage("\(prefix): \(error)")
}

try await vscode.start(
    manifest: UserscriptManifest(
        name: "copilot-userscript",
        version: "0.1.0",
        commands: [
            CommandContribution(
                id: "swiftCopilot.generate", title: "Swift Copilot: Generate Code"),
            CommandContribution(
                id: "swiftCopilot.explain", title: "Swift Copilot: Explain Selection"),
            CommandContribution(
                id: "swiftCopilot.refactor", title: "Swift Copilot: Refactor Selection"),
        ]
    )
) { command, _ in
    do {
        switch command {
        case "swiftCopilot.generate":
            guard let prompt = try await vscode.window.showInputBox(
                prompt: "Describe the code to generate"
            ), !prompt.isEmpty else { return nil }
            let lang = try await vscode.window.activeTextEditor()?.languageId ?? "text"
            let raw = try await llm.complete([
                ChatMessage(
                    role: "system",
                    content:
                        "You are a code generator inside VS Code. Reply with ONLY the requested \(lang) code — no prose, no markdown fences."
                ),
                ChatMessage(role: "user", content: prompt),
            ], temperature: 0.2)
            try await vscode.editor.insertOrReplaceSelection(
                LLMClient.stripCodeFences(raw))

        case "swiftCopilot.explain":
            var code: String?
            var lang = "text"
            if let ctx = try await selectionContext() {
                code = ctx.text.isEmpty ? nil : ctx.text
                lang = ctx.editor.languageId
            }
            if code == nil, let editor = try await vscode.window.activeTextEditor() {
                code = try await vscode.editor.documentText()
                lang = editor.languageId
            }
            guard let code, !code.isEmpty else {
                try await vscode.window.showInformationMessage(
                    "Nothing to explain — open a file or select some code.")
                return nil
            }
            let explanation = try await llm.complete([
                ChatMessage(
                    role: "system",
                    content:
                        "Explain the following \(lang) code concisely in markdown: what it does, key steps, notable edge cases."
                ),
                ChatMessage(role: "user", content: code),
            ])
            try await vscode.window.showUntitledDocument(
                content: "# Explanation\n\n\(explanation)", language: "markdown")

        case "swiftCopilot.refactor":
            guard let ctx = try await selectionContext(), !ctx.text.isEmpty else {
                try await vscode.window.showInformationMessage(
                    "Select the code to refactor first.")
                return nil
            }
            guard let instruction = try await vscode.window.showInputBox(
                prompt: "How should it be refactored?"
            ), !instruction.isEmpty else { return nil }
            let raw = try await llm.complete([
                ChatMessage(
                    role: "system",
                    content:
                        "Refactor the user's \(ctx.editor.languageId) code per the instruction. Reply with ONLY the rewritten code — no prose, no markdown fences."
                ),
                ChatMessage(
                    role: "user",
                    content: "Instruction: \(instruction)\n\n```\(ctx.editor.languageId)\n\(ctx.text)\n```"
                ),
            ], temperature: 0.2)
            try await vscode.editor.insertOrReplaceSelection(
                LLMClient.stripCodeFences(raw))

        default:
            throw UserscriptError.unknownCommand(command)
        }
    } catch {
        await reportError("Copilot userscript", error)
        throw error
    }
    return nil
}
