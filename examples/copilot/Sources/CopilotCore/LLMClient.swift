import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

/// Configuration for an OpenAI-compatible chat-completions endpoint.
///
/// Read from the userscript process environment — no secrets in source:
///   SWIFT_LLM_BASE_URL — e.g. http://localhost:11434/v1 (Ollama),
///                        https://api.openai.com/v1, LM Studio, vLLM, etc.
///   SWIFT_LLM_API_KEY  — optional bearer token; omit for local servers
///   SWIFT_LLM_MODEL    — model name the endpoint expects
public struct LLMConfig: Sendable {
    public var baseURL: URL
    public var apiKey: String?
    public var model: String
    public var timeout: TimeInterval

    public init(
        baseURL: URL = URL(string: "http://localhost:11434/v1")!,
        apiKey: String? = nil,
        model: String = "qwen2.5-coder",
        timeout: TimeInterval = 120
    ) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.model = model
        self.timeout = timeout
    }

    /// Environment-driven config (`SWIFT_LLM_*` variables).
    public static func fromEnvironment(
        _ env: [String: String] = ProcessInfo.processInfo.environment
    ) -> LLMConfig {
        var cfg = LLMConfig()
        if let raw = env["SWIFT_LLM_BASE_URL"], let url = URL(string: raw) {
            cfg.baseURL = url
        }
        if let key = env["SWIFT_LLM_API_KEY"], !key.isEmpty {
            cfg.apiKey = key
        }
        if let model = env["SWIFT_LLM_MODEL"], !model.isEmpty {
            cfg.model = model
        }
        return cfg
    }
}

public struct ChatMessage: Codable, Sendable {
    public var role: String
    public var content: String
    public init(role: String, content: String) {
        self.role = role
        self.content = content
    }
}

public enum LLMError: Error, Equatable {
    case badResponse(status: Int, body: String)
    case emptyChoices
}

/// Minimal OpenAI-compatible chat-completions client. The transport is
/// injectable so tests can exercise the request/response path offline.
public struct LLMClient: Sendable {
    public var config: LLMConfig
    private let transport: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    public init(
        config: LLMConfig = .fromEnvironment(),
        transport: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse) = {
            try await URLSession.shared.data(for: $0)
        }
    ) {
        self.config = config
        self.transport = transport
    }

    struct ChatRequest: Codable {
        var model: String
        var messages: [ChatMessage]
        var temperature: Double?
    }

    /// POST {baseURL}/chat/completions and return the first choice's content.
    public func complete(_ messages: [ChatMessage], temperature: Double? = nil)
        async throws -> String
    {
        var req = URLRequest(
            url: config.baseURL.appendingPathComponent("chat/completions"),
            timeoutInterval: config.timeout)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let key = config.apiKey {
            req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONEncoder().encode(
            ChatRequest(model: config.model, messages: messages, temperature: temperature))

        let (data, response) = try await transport(req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        guard (200..<300).contains(status) else {
            throw LLMError.badResponse(status: status, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try Self.extractContent(from: data)
    }

    /// Parse `choices[0].message.content` out of a chat.completion body.
    static func extractContent(from data: Data) throws -> String {
        struct Completion: Decodable {
            struct Choice: Decodable {
                struct Msg: Decodable { var content: String }
                var message: Msg
            }
            var choices: [Choice]
        }
        guard let first = try JSONDecoder().decode(Completion.self, from: data).choices.first
        else {
            throw LLMError.emptyChoices
        }
        return first.message.content
    }

    /// Strip ```lang fences LLMs insist on wrapping code in.
    public static func stripCodeFences(_ text: String) -> String {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.hasPrefix("```") else { return s }
        if let nl = s.firstIndex(of: "\n") {
            s = String(s[s.index(after: nl)...])
        }
        if s.hasSuffix("```") { s = String(s.dropLast(3)) }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
