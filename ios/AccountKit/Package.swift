// swift-tools-version: 6.0
// Everything of the Account app that is not a SwiftUI view: OIDC sign-in,
// token storage and refresh, the /api/account client and the view models.
// It builds for macOS too, so `swift test` runs the unit tests on a Mac
// without an iOS Simulator; CI also runs them on a simulator through the
// AccountApp scheme.
import PackageDescription

let package = Package(
    name: "AccountKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "AccountKit", targets: ["AccountKit"]),
    ],
    targets: [
        .target(name: "AccountKit"),
        .testTarget(name: "AccountKitTests", dependencies: ["AccountKit"]),
    ]
)
