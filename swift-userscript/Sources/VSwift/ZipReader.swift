import Foundation

/// Minimal ZIP reader covering what `vswift info` needs: list entries and
/// read stored (uncompressed) entries — the method `ZipWriter` produces.
/// Deflate entries are listed but their data is rejected (no zlib dep).
public struct ZipReader {
    public struct Entry: Sendable {
        public var name: String
        public var method: Int
        public var uncompressedSize: Int
        public var localHeaderOffset: Int
    }

    public enum ZipReaderError: Error {
        case notAZip
        case corruptDirectory
        case unsupportedCompression(Int)
        case sizeMismatch
    }

    private let data: Data
    public let entries: [Entry]

    public init(contentsOf url: URL) throws {
        let bytes = try [UInt8](Data(contentsOf: url))
        data = Data(bytes)
        var found: [Entry] = []
        // EOCD signature 0x06054b50, little-endian: 50 4B 05 06
        var eocd = -1
        if bytes.count >= 22 {
            var i = bytes.count - 22
            while i >= max(0, bytes.count - 22 - 0xFFFF) {
                if bytes[i] == 0x50 && bytes[i + 1] == 0x4B && bytes[i + 2] == 0x05
                    && bytes[i + 3] == 0x06
                {
                    eocd = i
                    break
                }
                i -= 1
            }
        }
        guard eocd >= 0 else { throw ZipReaderError.notAZip }
        let count = Int(Self.le16(bytes, eocd + 10))
        var pos = Int(Self.le32(bytes, eocd + 16))
        for _ in 0..<count {
            guard Self.le32(bytes, pos) == 0x0201_4b50 else {
                throw ZipReaderError.corruptDirectory
            }
            let method = Int(Self.le16(bytes, pos + 10))
            let usize = Int(Self.le32(bytes, pos + 24))
            let nameLen = Int(Self.le16(bytes, pos + 28))
            let extraLen = Int(Self.le16(bytes, pos + 30))
            let commentLen = Int(Self.le16(bytes, pos + 32))
            let lhOff = Int(Self.le32(bytes, pos + 42))
            let name = String(
                decoding: bytes[(pos + 46)..<(pos + 46 + nameLen)], as: UTF8.self)
            found.append(
                Entry(
                    name: name, method: method, uncompressedSize: usize,
                    localHeaderOffset: lhOff))
            pos += 46 + nameLen + extraLen + commentLen
        }
        entries = found
    }

    public func read(_ entry: Entry) throws -> Data {
        let bytes = [UInt8](data)
        let lh = entry.localHeaderOffset
        guard Self.le32(bytes, lh) == 0x0403_4b50 else { throw ZipReaderError.corruptDirectory }
        let nameLen = Int(Self.le16(bytes, lh + 26))
        let extraLen = Int(Self.le16(bytes, lh + 28))
        let start = lh + 30 + nameLen + extraLen
        guard entry.method == 0 else {
            throw ZipReaderError.unsupportedCompression(entry.method)
        }
        let out = data.subdata(in: start..<(start + entry.uncompressedSize))
        guard out.count == entry.uncompressedSize else { throw ZipReaderError.sizeMismatch }
        return out
    }

    private static func le16(_ b: [UInt8], _ o: Int) -> UInt16 {
        UInt16(b[o]) | UInt16(b[o + 1]) << 8
    }

    private static func le32(_ b: [UInt8], _ o: Int) -> UInt32 {
        UInt32(le16(b, o)) | UInt32(le16(b, o + 2)) << 16
    }
}
