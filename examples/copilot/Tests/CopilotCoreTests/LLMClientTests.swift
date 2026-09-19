import Foundation
import XCTest

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

@testable import CopilotCore

final class LLMClientTests: XCTestCase {
    private let sampleResponse = """
        {"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"print(1)"},"finish_reason":"stop"}]}
        """.data(using: .utf8)!

    private func okTransport() -> @Sendable (URLRequest) async throws -> (Data, URLResponse) {
        return { _ in
            (self.sampleResponse, HTTPURLResponse(
                url: URL(string: "http://x/v1/chat/completions")!,
                statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
    }

    func testCompleteExtractsFirstChoice() async throws {
        let client = LLMClient(config: LLMConfig(), transport: okTransport())
        let text = try await client.complete([ChatMessage(role: "user", content: "hi")])
        XCTAssertEqual(text, "print(1)")
    }

    func testRequestShape() async throws {
        var captured: URLRequest?
        let client = LLMClient(
            config: LLMConfig(
                baseURL: URL(string: "http://localhost:9/v1")!,
                apiKey: "k", model: "m"),
            transport: { req in
                captured = req
                return (self.sampleResponse, HTTPURLResponse(
                    url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            })
        _ = try await client.complete([ChatMessage(role: "user", content: "hi")])
        let req = try XCTUnwrap(captured)
        XCTAssertEqual(req.url?.path, "/v1/chat/completions")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer k")
        let body = try JSONDecoder().decode(
            LLMClient.ChatRequest.self, from: try XCTUnwrap(req.httpBody))
        XCTAssertEqual(body.model, "m")
        XCTAssertEqual(body.messages.first?.role, "user")
    }

    func testNon2xxThrows() async throws {
        let client = LLMClient(config: LLMConfig()) { req in
            ("nope".data(using: .utf8)!, HTTPURLResponse(
                url: req.url!, statusCode: 500, httpVersion: nil, headerFields: nil)!)
        }
        do {
            _ = try await client.complete([])
            XCTFail("expected throw")
        } catch let LLMError.badResponse(status, _) {
            XCTAssertEqual(status, 500)
        }
    }

    func testStripCodeFences() {
        XCTAssertEqual(LLMClient.stripCodeFences("```swift\nfoo()\n```"), "foo()")
        XCTAssertEqual(LLMClient.stripCodeFences("plain()"), "plain()")
    }

    func testEnvConfig() {
        let cfg = LLMConfig.fromEnvironment([
            "SWIFT_LLM_BASE_URL": "http://example.com/v1",
            "SWIFT_LLM_API_KEY": "secret",
            "SWIFT_LLM_MODEL": "test-model",
        ])
        XCTAssertEqual(cfg.baseURL.absoluteString, "http://example.com/v1")
        XCTAssertEqual(cfg.apiKey, "secret")
        XCTAssertEqual(cfg.model, "test-model")
    }
}
