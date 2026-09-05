import XCTest

@testable import SparkComputerHostCore

final class NativeSettlePolicyTests: XCTestCase {
  func testWaitsThroughBaselineWindow() {
    XCTAssertEqual(
      NativeSettlePolicy.decide(elapsedMs: 100, msSinceLastChange: 100, busy: false),
      .keepWaiting)
  }

  func testSettlesAfterQuietWindow() {
    XCTAssertEqual(
      NativeSettlePolicy.decide(elapsedMs: 600, msSinceLastChange: 350, busy: false),
      .settled)
  }

  func testBusyIndicatorExtendsTheWait() {
    XCTAssertEqual(
      NativeSettlePolicy.decide(elapsedMs: 600, msSinceLastChange: 400, busy: true),
      .keepWaiting)
  }

  func testHardCapSettlesAnimatedInterfaces() {
    XCTAssertEqual(
      NativeSettlePolicy.decide(elapsedMs: 2_000, msSinceLastChange: 0, busy: true),
      .settled)
  }

  func testRecentChangeKeepsWaiting() {
    XCTAssertEqual(
      NativeSettlePolicy.decide(elapsedMs: 600, msSinceLastChange: 80, busy: false),
      .keepWaiting)
  }
}
