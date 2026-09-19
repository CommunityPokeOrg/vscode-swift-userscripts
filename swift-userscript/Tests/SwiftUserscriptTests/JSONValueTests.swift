import XCTest

@testable import SwiftUserscript

final class JSONValueTests: XCTestCase {
    func testRoundTrip() throws {
        let value: JSONValue = [
            "name": "hello",
            "count": 42,
            "ok": true,
            "items": ["a", "b"],
            "nothing": nil,
        ]
        let data = try JSONEncoder().encode(value)
        let back = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(value, back)
    }

    func testEncodingBridge() throws {
        let manifest = UserscriptManifest(
            name: "m", version: "1.0",
            commands: [CommandContribution(id: "a.b", title: "T")])
        let v = try JSONValue.encoding(manifest)
        XCTAssertEqual(v["name"], "m")
        XCTAssertEqual(v["contributes"]?["commands"]?.arrayValue?.count, 1)
    }
}
