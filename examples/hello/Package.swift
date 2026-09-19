// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "hello-userscript",
    dependencies: [
        .package(path: "../../swift-userscript"),
    ],
    targets: [
        .executableTarget(
            name: "HelloUserscript",
            dependencies: [.product(name: "SwiftUserscript", package: "swift-userscript")]
        ),
    ]
)
