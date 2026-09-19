import Foundation
import VSwift

let usage = """
    usage:
      vswift pack <package-dir> [--product <name>] [-o <out.vswift>]
                  [--name <n>] [--version <v>]
                  [--binary <triple>=<path-to-binary>]...
                  [--assets <dir>]
      vswift info <file.vswift>

    pack: builds `swift build -c release --product <name>` in <package-dir>
    (host triple auto-detected via `swiftc -print-target-info`), then writes a
    .vswift bundle containing userscript.json, bin/<triple>/<binary>, and an
    optional assets/ directory. Repeat --binary to embed additional
    prebuilt binaries for other platforms (cross-compile them yourself with
    `swift build --triple <triple>` or a swift-sdk and pass the paths here).
    """

struct Args {
    var positional: [String] = []
    var options: [String: [String]] = [:]

    init(_ argv: [String]) {
        var i = 0
        while i < argv.count {
            let a = argv[i]
            if a.hasPrefix("--") {
                let key = String(a.dropFirst(2))
                if i + 1 < argv.count && !argv[i + 1].hasPrefix("--") {
                    options[key, default: []].append(argv[i + 1])
                    i += 1
                } else {
                    options[key, default: []].append("")
                }
            } else if a == "-o", i + 1 < argv.count {
                options["o", default: []].append(argv[i + 1])
                i += 1
            } else {
                positional.append(a)
            }
            i += 1
        }
    }

    func opt(_ key: String) -> String? { options[key]?.last }
    func optAll(_ key: String) -> [String] { options[key] ?? [] }
}

func run(_ cmd: String, _ args: [String], cwd: URL?) throws {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [cmd] + args
    p.currentDirectoryURL = cwd
    try p.run()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else {
        throw NSError(
            domain: "vswift", code: Int(p.terminationStatus),
            userInfo: [NSLocalizedDescriptionKey: "\(cmd) exited \(p.terminationStatus)"])
    }
}

func capture(_ cmd: String, _ args: [String]) throws -> String {
    let p = Process()
    let pipe = Pipe()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = [cmd] + args
    p.standardOutput = pipe
    try p.run()
    p.waitUntilExit()
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
}

func hostTriple() throws -> String {
    struct Info: Decodable { struct Target: Decodable { var triple: String }
        var target: Target }
    let out = try capture("swiftc", ["-print-target-info"])
    let info = try JSONDecoder().decode(Info.self, from: out.data(using: .utf8)!)
    return info.target.triple
}

func pack(_ args: Args) throws {
    guard let dirArg = args.positional.first else {
        FileHandle.standardError.write("pack: missing <package-dir>\n".data(using: .utf8)!)
        throw NSError(domain: "vswift", code: 2)
    }
    let packageDir = URL(fileURLWithPath: dirArg).standardizedFileURL
    let fm = FileManager.default

    var binaries: [String: (archivePath: String, source: URL)] = [:]
    let name = args.opt("name") ?? packageDir.lastPathComponent
    let version = args.opt("version") ?? "0.0.0"

    for b in args.optAll("binary") {
        let parts = b.split(separator: "=", maxSplits: 1).map(String.init)
        guard parts.count == 2 else {
            throw NSError(
                domain: "vswift", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "bad --binary '\(b)' (want triple=path)"])
        }
        let src = URL(fileURLWithPath: parts[1])
        binaries[parts[0]] = ("bin/\(parts[0])/\(src.lastPathComponent)", src)
    }

    if let product = args.opt("product") {
        print("vswift: building \(product) (release)…")
        try run("swift", ["build", "-c", "release", "--product", product], cwd: packageDir)
        let triple = try hostTriple()
        let bin = packageDir.appendingPathComponent(".build/release/\(product)")
        guard fm.fileExists(atPath: bin.path) else {
            throw NSError(
                domain: "vswift", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "build product not found at \(bin.path)"])
        }
        binaries[triple] = ("bin/\(triple)/\(product)", bin)
    }

    guard !binaries.isEmpty else {
        throw NSError(
            domain: "vswift", code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: "nothing to pack — pass --product or --binary",
            ])
    }

    var zip = ZipWriter()
    let manifest = VSwiftManifest(
        name: name, version: version,
        binaries: binaries.mapValues { $0.archivePath },
        assets: nil)
    try zip.addFile(
        name: "userscript.json",
        data: JSONEncoder().encode(manifest))

    for (_, entry) in binaries {
        try zip.addFile(name: entry.archivePath, source: entry.source, permissions: 0o755)
        print("vswift: + \(entry.archivePath)")
    }

    let assetsDir = args.opt("assets").map { URL(fileURLWithPath: $0) }
        ?? packageDir.appendingPathComponent("assets")
    if fm.fileExists(atPath: assetsDir.path) {
        let enumerator = fm.enumerator(at: assetsDir, includingPropertiesForKeys: nil)!
        for case let f as URL in enumerator {
            var isDir: ObjCBool = false
            _ = fm.fileExists(atPath: f.path, isDirectory: &isDir)
            guard !isDir.boolValue else { continue }
            let rel = String(f.path.dropFirst(assetsDir.path.count + 1))
            try zip.addFile(name: "assets/\(rel)", source: f)
            print("vswift: + assets/\(rel)")
        }
    }

    let out = URL(fileURLWithPath: args.opt("o") ?? "\(name)-\(version).vswift")
    try zip.write(to: out)
    print("vswift: wrote \(out.path)")
}

func info(_ args: Args) throws {
    guard let file = args.positional.first else {
        FileHandle.standardError.write("info: missing <file.vswift>\n".data(using: .utf8)!)
        throw NSError(domain: "vswift", code: 2)
    }
    let reader = try ZipReader(contentsOf: URL(fileURLWithPath: file))
    print("entries:")
    for e in reader.entries {
        print("  \(e.name) (\(e.uncompressedSize) bytes, method \(e.method))")
    }
    if let m = reader.entries.first(where: { $0.name == "userscript.json" }) {
        let manifest = try JSONDecoder().decode(
            VSwiftManifest.self, from: try reader.read(m))
        print("manifest: \(manifest.name) \(manifest.version)")
        print("  formatVersion: \(manifest.formatVersion)")
        print("  binaries:")
        for (triple, path) in manifest.binaries.sorted(by: { $0.key < $1.key }) {
            print("    \(triple): \(path)")
        }
    } else {
        print("manifest: MISSING (not a valid .vswift bundle)")
    }
}

let argv = Array(ProcessInfo.processInfo.arguments.dropFirst())
do {
    guard let sub = argv.first else {
        print(usage)
        exit(2)
    }
    let args = Args(Array(argv.dropFirst()))
    switch sub {
    case "pack": try pack(args)
    case "info": try info(args)
    default:
        FileHandle.standardError.write("unknown subcommand \(sub)\n".data(using: .utf8)!)
        print(usage)
        exit(2)
    }
} catch {
    FileHandle.standardError.write("vswift: error: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
