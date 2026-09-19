import SwiftUserscript

let vscode = VSCode()

try await vscode.start(
    manifest: UserscriptManifest(
        name: "hello-userscript",
        version: "0.1.0",
        commands: [
            CommandContribution(id: "swiftHello.sayHello", title: "Swift: Say Hello"),
            CommandContribution(
                id: "swiftHello.showSelection", title: "Swift: Show Selection Info"),
            CommandContribution(
                id: "swiftHello.askAndGreet", title: "Swift: Ask Name And Greet"),
        ]
    )
) { command, _ in
    switch command {
    case "swiftHello.sayHello":
        try await vscode.window.showInformationMessage("Hello from Swift!")
        return nil

    case "swiftHello.showSelection":
        if let editor = try await vscode.window.activeTextEditor(),
            let text = editor.selectedText, !text.isEmpty
        {
            try await vscode.window.showInformationMessage(
                "Selected \(text.count) chars in \(editor.fileName)")
        } else {
            try await vscode.window.showInformationMessage("No active selection.")
        }
        return nil

    case "swiftHello.askAndGreet":
        let name = try await vscode.window.showInputBox(prompt: "What is your name?")
        try await vscode.window.showInformationMessage("Hello, \(name ?? "stranger")!")
        return nil

    default:
        throw UserscriptError.unknownCommand(command)
    }
}
