// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "swift-userscript",
    products: [
        .library(name: "SwiftUserscript", targets: ["SwiftUserscript"]),
        .library(name: "VSwift", targets: ["VSwift"]),
        .executable(name: "vswift", targets: ["VSwiftTool"]),
    ],
    targets: [
        .target(name: "SwiftUserscript"),
        .target(name: "VSwift"),
        .executableTarget(name: "VSwiftTool", dependencies: ["VSwift"]),
        .testTarget(
            name: "SwiftUserscriptTests",
            dependencies: ["SwiftUserscript"]
        ),
        .testTarget(
            name: "VSwiftTests",
            dependencies: ["VSwift"]
        ),
    ]
)
