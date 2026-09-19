import Foundation

/// Table-driven CRC32 (IEEE polynomial).
public enum CRC32 {
    private static let table: [UInt32] = (0..<256).map { i in
        var c = UInt32(i)
        for _ in 0..<8 {
            c = (c & 1 != 0) ? (0xEDB8_8320 ^ (c >> 1)) : (c >> 1)
        }
        return c
    }

    public static func checksum(_ data: Data) -> UInt32 {
        var c: UInt32 = 0xFFFF_FFFF
        for b in data {
            c = table[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8)
        }
        return c ^ 0xFFFF_FFFF
    }
}

/// Minimal ZIP writer — stored (uncompressed) entries only, which is all the
/// .vswift format needs (binaries compress poorly anyway). Deflate archives
/// produced by other tools are still readable by the host's extractor.
public struct ZipWriter {
    public struct Entry {
        var name: String
        var data: Data
        var permissions: UInt16
    }

    private var entries: [Entry] = []

    public init() {}

    /// `name` must be a forward-slash relative path (no leading `/`, no `..`).
    public mutating func addFile(name: String, data: Data, permissions: UInt16 = 0o644) throws {
        guard !name.hasPrefix("/"), !name.hasPrefix("\\"),
            !name.split(separator: "/").contains(".."),
            !name.contains("\\")
        else {
            throw ZipWriterError.unsafeEntryName(name)
        }
        entries.append(Entry(name: name, data: data, permissions: permissions))
    }

    public mutating func addFile(name: String, source: URL, permissions: UInt16 = 0o644) throws {
        try addFile(name: name, data: Data(contentsOf: source), permissions: permissions)
    }

    public enum ZipWriterError: Error {
        case unsafeEntryName(String)
    }

    public func write(to url: URL) throws {
        var out = Data()
        var central = Data()
        var offset: UInt32 = 0

        for e in entries {
            let nameData = e.name.data(using: .utf8)!
            let crc = CRC32.checksum(e.data)
            let size = UInt32(e.data.count)

            // Local file header
            out.appendLE32(0x0403_4b50)  // signature
            out.appendLE16(20)  // version needed
            out.appendLE16(0)  // flags
            out.appendLE16(0)  // method: store
            out.appendLE16(0)  // mod time
            out.appendLE16(0)  // mod date
            out.appendLE32(crc)
            out.appendLE32(size)
            out.appendLE32(size)
            out.appendLE16(UInt16(nameData.count))
            out.appendLE16(0)  // extra len
            out.append(nameData)
            out.append(e.data)

            // Central directory record
            central.appendLE32(0x0201_4b50)
            central.appendLE16(3 << 8 | 20)  // version made by: unix, 2.0
            central.appendLE16(20)  // version needed
            central.appendLE16(0)  // flags
            central.appendLE16(0)  // method
            central.appendLE16(0)  // time
            central.appendLE16(0)  // date
            central.appendLE32(crc)
            central.appendLE32(size)
            central.appendLE32(size)
            central.appendLE16(UInt16(nameData.count))
            central.appendLE16(0)  // extra
            central.appendLE16(0)  // comment
            central.appendLE16(0)  // disk
            central.appendLE16(0)  // internal attrs
            central.appendLE32(UInt32(e.permissions) << 16)  // external attrs
            central.appendLE32(offset)
            central.append(nameData)

            offset += UInt32(30 + nameData.count + e.data.count)
        }

        let cdOffset = offset
        out.append(central)
        out.appendLE32(0x0605_4b50)  // EOCD
        out.appendLE16(0)  // disk
        out.appendLE16(0)  // cd disk
        out.appendLE16(UInt16(entries.count))
        out.appendLE16(UInt16(entries.count))
        out.appendLE32(UInt32(central.count))
        out.appendLE32(cdOffset)
        out.appendLE16(0)  // comment len

        try out.write(to: url)
    }
}

extension Data {
    mutating func appendLE16(_ v: UInt16) {
        Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) }
    }

    mutating func appendLE32(_ v: UInt32) {
        Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) }
    }
}
