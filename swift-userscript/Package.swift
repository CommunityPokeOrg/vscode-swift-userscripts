// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "swift-userscript",
    products: [
        .library(name: "SwiftUserscript", targets: ["SwiftUserscript"]),
    ],
    targets: [
        .target(name: "SwiftUserscript"),
        .testTarget(
            name: "SwiftUserscriptTests",
            dependencies: ["SwiftUserscript"]
        ),
    ]
)
