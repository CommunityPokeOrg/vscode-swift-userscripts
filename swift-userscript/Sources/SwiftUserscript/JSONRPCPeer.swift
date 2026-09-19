import Foundation

public struct RPCError: Error, Codable, Sendable {
    public var code: Int
    public var message: String
    public var data: JSONValue?

    public init(code: Int, message: String, data: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}

/// Single tolerant decode target: one of request / response / notification.
private struct IncomingMessage: Decodable {
    var id: Int?
    var method: String?
    var params: JSONValue?
    var result: JSONValue?
    var error: RPCError?
}

private struct OutgoingRequest: Encodable {
    let jsonrpc = "2.0"
    let id: Int
    let method: String
    let params: JSONValue?
}

private struct OutgoingResponse: Encodable {
    let jsonrpc = "2.0"
    let id: Int
    let result: JSONValue?
    let error: RPCError?

    enum CodingKeys: String, CodingKey {
        case jsonrpc, id, result, error
    }

    /// JSON-RPC requires exactly one of `result` / `error` to be present —
    /// a nil handler return must serialize as `"result": null`, not be omitted.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(jsonrpc, forKey: .jsonrpc)
        try c.encode(id, forKey: .id)
        if let error {
            try c.encode(error, forKey: .error)
        } else {
            try c.encode(result ?? .null, forKey: .result)
        }
    }
}

private struct OutgoingNotification: Encodable {
    let jsonrpc = "2.0"
    let method: String
    let params: JSONValue?
}

/// Bidirectional JSON-RPC 2.0 endpoint over stdin/stdout,
/// newline-delimited (one JSON value per line).
///
/// Incoming requests are dispatched in child tasks so a handler may itself
/// `await` requests back to the host without deadlocking the read loop.
public actor JSONRPCPeer {
    public typealias RequestHandler = (JSONValue?) async throws -> JSONValue?
    public typealias NotificationHandler = (JSONValue?) -> Void

    private var nextID = 1
    private var pending: [Int: CheckedContinuation<JSONValue, Error>] = [:]
    private var requestHandlers: [String: RequestHandler] = [:]
    private var notificationHandlers: [String: NotificationHandler] = [:]

    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private let output = FileHandle.standardOutput

    public init() {}

    public func onRequest(_ method: String, handler: @escaping RequestHandler) {
        requestHandlers[method] = handler
    }

    public func onNotification(_ method: String, handler: @escaping NotificationHandler) {
        notificationHandlers[method] = handler
    }

    /// Send a request and await the correlated response.
    public func request(_ method: String, params: JSONValue? = nil) async throws -> JSONValue {
        let id = nextID
        nextID += 1
        return try await withCheckedThrowingContinuation { cont in
            pending[id] = cont
            send(OutgoingRequest(id: id, method: method, params: params))
        }
    }

    /// Fire-and-forget notification.
    public func notify(_ method: String, params: JSONValue? = nil) {
        send(OutgoingNotification(method: method, params: params))
    }

    /// Read loop. Returns when stdin is closed (host shutdown).
    ///
    /// Nonisolated on purpose: the synchronous `readLine()` blocks the
    /// caller's thread rather than the actor's executor, so request handlers
    /// can still call back into the peer while this loop is parked on stdin.
    /// Ordering is preserved — each line is awaited on the actor in turn.
    public nonisolated func run() async throws {
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8), !data.isEmpty else { continue }
            do {
                try await handleLine(data)
            } catch {
                FileHandle.standardError.write(
                    "[SwiftUserscript] dropping malformed RPC line: \(error)\n"
                        .data(using: .utf8)!
                )
            }
        }
    }

    private func handleLine(_ data: Data) throws {
        handle(try decoder.decode(IncomingMessage.self, from: data))
    }

    private func handle(_ msg: IncomingMessage) {
        if let id = msg.id, let method = msg.method {
            let handler = requestHandlers[method]
            Task {
                let response: OutgoingResponse
                if let handler {
                    do {
                        response = OutgoingResponse(
                            id: id, result: try await handler(msg.params), error: nil)
                    } catch let e as RPCError {
                        response = OutgoingResponse(id: id, result: nil, error: e)
                    } catch {
                        response = OutgoingResponse(
                            id: id,
                            result: nil,
                            error: RPCError(code: -32603, message: String(describing: error)))
                    }
                } else {
                    response = OutgoingResponse(
                        id: id,
                        result: nil,
                        error: RPCError(code: -32601, message: "Method not found: \(method)"))
                }
                self.send(response)
            }
        } else if let id = msg.id {
            if let cont = pending.removeValue(forKey: id) {
                if let error = msg.error {
                    cont.resume(throwing: error)
                } else {
                    cont.resume(returning: msg.result ?? .null)
                }
            }
        } else if let method = msg.method {
            notificationHandlers[method]?(msg.params)
        }
    }

    private func send<T: Encodable>(_ value: T) {
        do {
            var data = try encoder.encode(value)
            data.append(0x0A)
            output.write(data)
        } catch {
            FileHandle.standardError.write(
                "[SwiftUserscript] failed to encode RPC message: \(error)\n".data(using: .utf8)!
            )
        }
    }
}
