import XCTest

@testable import SparkComputerHostCore

final class NativeInterruptionTokenTests: XCTestCase {
  func testFreshTokenDoesNotAbort() {
    let token = NativeInterruptionToken()
    XCTAssertFalse(token.isRequested)
    XCTAssertNoThrow(try token.check())
  }

  func testRequestAbortsLoops() {
    let token = NativeInterruptionToken()
    token.request()
    XCTAssertTrue(token.isRequested)
    XCTAssertThrowsError(try token.check()) { error in
      XCTAssertEqual(error as? NativeHostPlatformError, .userTakeover)
    }
  }

  func testBeginDropsStaleRequest() {
    // An Esc pressed between actions (or before the next action started) must
    // never cancel the NEXT action — begin() at action start clears it.
    let token = NativeInterruptionToken()
    token.request()
    token.begin()
    XCTAssertFalse(token.isRequested)
    XCTAssertNoThrow(try token.check())
  }

  func testRequestAfterBeginAborts() {
    let token = NativeInterruptionToken()
    token.begin()
    token.request()
    XCTAssertTrue(token.isRequested)
  }

  func testConcurrentRequestAndCheckStayConsistent() {
    let token = NativeInterruptionToken()
    let expectation = expectation(description: "requester")
    DispatchQueue.global().async {
      for _ in 0..<10_000 { token.request() }
      expectation.fulfill()
    }
    var sawAbort = false
    for _ in 0..<10_000 {
      if token.isRequested { sawAbort = true; break }
    }
    wait(for: [expectation], timeout: 5)
    XCTAssertTrue(sawAbort, "a concurrent request() must become visible to pollers")
  }
}
