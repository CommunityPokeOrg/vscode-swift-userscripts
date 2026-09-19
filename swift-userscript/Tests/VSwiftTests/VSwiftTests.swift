import XCTest

@testable import VSwift

final class VSwiftTests: XCTestCase {
    private func tempURL(_ name: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("vswift-test-\(UUID().uuidString)-\(name)")
    }

    func testZipRoundTrip() throws {
        var zip = ZipWriter()
        let payload = Data("hello world".utf8)
        try zip.addFile(name: "userscript.json", data: payload)
        try zip.addFile(name: "bin/x86_64-unknown-linux-gnu/tool", data: Data([1, 2, 3]),
                        permissions: 0o755)
        let url = tempURL("t.vswift")
        try zip.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }

        let reader = try ZipReader(contentsOf: url)
        XCTAssertEqual(reader.entries.count, 2)
        let manifest = reader.entries.first { $0.name == "userscript.json" }!
        XCTAssertEqual(try reader.read(manifest), payload)
        let bin = reader.entries.first { $0.name.contains("tool") }!
        XCTAssertEqual(try reader.read(bin), Data([1, 2, 3]))
    }

    func testRejectsUnsafeEntryNames() throws {
        var zip = ZipWriter()
        XCTAssertThrowsError(try zip.addFile(name: "../evil", data: Data()))
        XCTAssertThrowsError(try zip.addFile(name: "/abs", data: Data()))
        XCTAssertThrowsError(try zip.addFile(name: "a/../../b", data: Data()))
        XCTAssertThrowsError(try zip.addFile(name: "win\\..\\evil", data: Data()))
    }

    func testManifestRoundTrip() throws {
        let m = VSwiftManifest(
            name: "t", version: "1.2.3",
            binaries: ["x86_64-unknown-linux-gnu": "bin/x/tool"])
        let data = try JSONEncoder().encode(m)
        let back = try JSONDecoder().decode(VSwiftManifest.self, from: data)
        XCTAssertEqual(back.formatVersion, 1)
        XCTAssertEqual(back.name, "t")
        XCTAssertEqual(back.binaries["x86_64-unknown-linux-gnu"], "bin/x/tool")
    }

    func testCRC32KnownVector() {
        // CRC32("123456789") = 0xCBF43926 (standard check value)
        XCTAssertEqual(CRC32.checksum(Data("123456789".utf8)), 0xCBF4_3926)
    }
}
