// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "SparkComputerHost",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "SparkComputerHost", targets: ["SparkComputerHost"])
  ],
  targets: [
    .target(name: "SparkComputerHostCore"),
    .executableTarget(
      name: "SparkComputerHost",
      dependencies: ["SparkComputerHostCore"],
      linkerSettings: [
        .linkedFramework("AppKit"),
        .linkedFramework("ApplicationServices"),
        .linkedFramework("CoreGraphics"),
        .linkedFramework("ImageIO"),
        .linkedFramework("ScreenCaptureKit"),
        .linkedFramework("Security"),
        .linkedFramework("UniformTypeIdentifiers"),
      ]
    ),
    .testTarget(name: "SparkComputerHostCoreTests", dependencies: ["SparkComputerHostCore"]),
  ]
)
