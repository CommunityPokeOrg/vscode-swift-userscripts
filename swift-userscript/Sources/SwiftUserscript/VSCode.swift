import Foundation

extension JSONValue {
    /// Bridge an Encodable model into an untyped JSONValue.
    public static func encoding<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Decode this untyped value into a Decodable model.
    public func decoding<T: Decodable>(_ type: T.Type) throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(T.self, from: data)
    }
}

public struct CommandContribution: Codable, Sendable {
    public var id: String
    public var title: String
    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

/// Declared by the script during `initialize`; the host registers each
/// contributed command with VS Code and routes invocations back here.
public struct UserscriptManifest: Codable, Sendable {
    public var name: String
    public var version: String
    public var contributes: Contributes

    public struct Contributes: Codable, Sendable {
        public var commands: [CommandContribution]
        public init(commands: [CommandContribution]) {
            self.commands = commands
        }
    }

    public init(name: String, version: String, commands: [CommandContribution]) {
        self.name = name
        self.version = version
        self.contributes = Contributes(commands: commands)
    }
}

public struct ActiveTextEditor: Codable, Sendable {
    public var uri: String
    public var fileName: String
    public var languageId: String
    public var selectedText: String?
}

public enum UserscriptError: Error {
    case unknownCommand(String)
}

/// Facade a userscript drives VS Code through. One instance per process.
public final class VSCode: Sendable {
    let peer = JSONRPCPeer()

    public let window: Window
    public let env: Env
    public let editor: Editor

    public init() {
        self.window = Window(peer: peer)
        self.env = Env(peer: peer)
        self.editor = Editor(peer: peer)
    }

    public struct Window: Sendable {
        fileprivate let peer: JSONRPCPeer
    }

    public struct Env: Sendable {
        fileprivate let peer: JSONRPCPeer
    }

    public struct Editor: Sendable {
        fileprivate let peer: JSONRPCPeer
    }

    /// Register protocol handlers and run the read loop until the host closes
    /// stdin — call as the last step of main. The host initiates `initialize`
    /// (LSP-style); this script replies with its manifest.
    public func start(
        manifest: UserscriptManifest,
        onCommand: @escaping @Sendable (String, [JSONValue]) async throws -> JSONValue?
    ) async throws {
        await peer.onRequest("initialize") { _ in
            try .encoding(manifest)
        }
        await peer.onRequest("workspace/executeCommand") { params in
            guard let params,
                let command = params["command"]?.stringValue
            else { return nil }
            let args = params["arguments"]?.arrayValue ?? []
            return try await onCommand(command, args)
        }
        await peer.onNotification("shutdown") { _ in
            exit(0)
        }
        try await peer.run()
    }

    /// Write a line to the host's "Swift Userscripts" output channel.
    public func log(_ message: String) async {
        await peer.notify("vscode/log", params: ["message": .string(message)])
    }
}

extension VSCode.Window {
    @discardableResult
    public func showInformationMessage(_ message: String, items: [String] = [])
        async throws -> String?
    {
        let r = try await peer.request(
            "vscode/window.showInformationMessage",
            params: ["message": .string(message), "items": .array(items.map { .string($0) })])
        return r.stringValue
    }

    @discardableResult
    public func showErrorMessage(_ message: String, items: [String] = []) async throws -> String? {
        let r = try await peer.request(
            "vscode/window.showErrorMessage",
            params: ["message": .string(message), "items": .array(items.map { .string($0) })])
        return r.stringValue
    }

    public func showInputBox(prompt: String? = nil, placeHolder: String? = nil) async throws
        -> String?
    {
        let r = try await peer.request(
            "vscode/window.showInputBox",
            params: [
                "prompt": prompt.map { .string($0) } ?? .null,
                "placeHolder": placeHolder.map { .string($0) } ?? .null,
            ])
        return r.stringValue
    }

    public func showQuickPick(_ items: [String], placeHolder: String? = nil) async throws
        -> String?
    {
        let r = try await peer.request(
            "vscode/window.showQuickPick",
            params: [
                "items": .array(items.map { .string($0) }),
                "placeHolder": placeHolder.map { .string($0) } ?? .null,
            ])
        return r.stringValue
    }

    public func activeTextEditor() async throws -> ActiveTextEditor? {
        let r = try await peer.request("vscode/window.activeTextEditor")
        if r == .null { return nil }
        return try r.decoding(ActiveTextEditor.self)
    }

    /// Open an untitled document (e.g. for generated explanations/output) and
    /// show it in a non-preview tab.
    @discardableResult
    public func showUntitledDocument(content: String, language: String = "markdown")
        async throws -> String
    {
        let r = try await peer.request(
            "vscode/window.showUntitledDocument",
            params: ["content": .string(content), "language": .string(language)])
        return r["uri"]?.stringValue ?? ""
    }
}

extension VSCode.Editor {
    /// Insert `text` at the cursor, replacing the current selection if any.
    public func insertOrReplaceSelection(_ text: String) async throws {
        _ = try await peer.request(
            "vscode/editor.insertOrReplaceSelection",
            params: ["text": .string(text)])
    }

    /// Full text of the active editor's document, or nil when no editor.
    public func documentText() async throws -> String? {
        try await peer.request("vscode/editor.documentText").stringValue
    }
}

extension VSCode.Env {
    public func clipboardReadText() async throws -> String {
        try await peer.request("vscode/env.clipboardReadText").stringValue ?? ""
    }

    public func clipboardWriteText(_ text: String) async throws {
        _ = try await peer.request(
            "vscode/env.clipboardWriteText", params: ["message": .string(text)])
    }
}
