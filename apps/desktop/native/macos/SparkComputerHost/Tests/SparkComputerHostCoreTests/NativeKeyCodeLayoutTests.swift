import XCTest

@testable import SparkComputerHostCore

final class NativeKeyCodeLayoutTests: XCTestCase {
  func testUSFallbackTableCoversLettersDigitsAndShiftedSymbols() {
    XCTAssertNotNil(NativeKeyCodeLayout.resolve(character: "a"))
    XCTAssertNotNil(NativeKeyCodeLayout.resolve(character: "Z"))
    XCTAssertNotNil(NativeKeyCodeLayout.resolve(character: "5"))
    XCTAssertNotNil(NativeKeyCodeLayout.resolve(character: "!"))
    // Non-ASCII resolves through the fallback only → nil here.
    XCTAssertNil(NativeKeyCodeLayout.resolve(character: "你"))
  }

  func testUSFallbackMarksShiftWhereExpected() {
    XCTAssertEqual(NativeKeyCodeLayout.resolve(character: "a")?.shift, false)
    XCTAssertEqual(NativeKeyCodeLayout.resolve(character: "A")?.shift, true)
    XCTAssertEqual(NativeKeyCodeLayout.resolve(character: "!")?.shift, true)
    XCTAssertEqual(NativeKeyCodeLayout.resolve(character: "9")?.shift, false)
  }

  func testEmptyLayoutDataYieldsEmptyMapAndFallbackStillResolves() {
    let map = NativeKeyCodeLayout.buildMap(fromLayoutData: nil)
    XCTAssertTrue(map.isEmpty)
    // Resolution survives without layout data via the US table.
    XCTAssertEqual(NativeKeyCodeLayout.resolve(character: "q")?.code, 12)
  }
}
