import XCTest

/// Launches the app with `-ui-testing`: in-memory credentials and a network
/// that is always offline, so nothing reaches a real server.
final class LaunchTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testLaunchShowsSignIn() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["sign-in"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testSignInWithoutNetworkShowsAnError() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing"]
        app.launch()
        let signIn = app.buttons["sign-in"]
        XCTAssertTrue(signIn.waitForExistence(timeout: 10))
        signIn.tap()
        // Discovery fails offline before any browser sheet opens.
        XCTAssertTrue(app.staticTexts["sign-in-error"].waitForExistence(timeout: 10))
    }

    @MainActor
    func testSignInScreenAtLargestTextSize() {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.buttons["sign-in"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["sign-in"].isHittable)
    }
}
