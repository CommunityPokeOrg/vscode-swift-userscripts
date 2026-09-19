// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "copilot-userscript",
    dependencies: [
        .package(path: "../../swift-userscript"),
    ],
    targets: [
        .target(
            name: "CopilotCore",
            dependencies: [.product(name: "SwiftUserscript", package: "swift-userscript")]
        ),
        .executableTarget(
            name: "CopilotUserscript",
            dependencies: ["CopilotCore"]
        ),
        .testTarget(
            name: "CopilotCoreTests",
            dependencies: ["CopilotCore"]
        ),
    ]
)
