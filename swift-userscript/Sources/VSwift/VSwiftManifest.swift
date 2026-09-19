import Foundation

/// The `userscript.json` manifest inside a `.vswift` bundle.
public struct VSwiftManifest: Codable, Sendable {
    public static let formatVersion = 1

    public var formatVersion: Int
    public var name: String
    public var version: String
    /// platform triple/shorthand → archive-relative binary path
    public var binaries: [String: String]
    /// optional archive-relative asset directory
    public var assets: String?

    public init(
        name: String,
        version: String,
        binaries: [String: String],
        assets: String? = nil
    ) {
        self.formatVersion = Self.formatVersion
        self.name = name
        self.version = version
        self.binaries = binaries
        self.assets = assets
    }
}
