import XCTest

@testable import SparkComputerHostCore

final class NativeWindowInventoryMapperTests: XCTestCase {
  func testParsesWindowIdentifiersWithoutRecursingThroughTheUInt32Typealias() {
    XCTAssertEqual(NativeWindowIDParser.parse("42"), 42)
    XCTAssertNil(NativeWindowIDParser.parse("-1"))
    XCTAssertNil(NativeWindowIDParser.parse("4294967296"))
  }

  func testMapsRetinaCoordinatesToTheDisplayWithTheLargestIntersection() throws {
    let displays = [
      RawNativeDisplay(
        id: "1",
        pixelWidth: 1_920,
        pixelHeight: 1_080,
        frame: NativeRect(x: 0, y: 0, width: 1_920, height: 1_080)
      ),
      RawNativeDisplay(
        id: "2",
        pixelWidth: 3_456,
        pixelHeight: 2_234,
        frame: NativeRect(x: 1_920, y: 0, width: 1_728, height: 1_117)
      ),
    ]
    let windows = [
      RawNativeWindow(
        id: "42",
        title: "Project",
        frame: NativeRect(x: 2_000, y: 80, width: 1_200, height: 900),
        isOnScreen: true,
        processID: 123,
        applicationName: "Editor",
        bundleID: "com.spark.Editor",
        executableIdentity: "com.spark.Editor",
        signingIdentity: "ABCDE12345"
      )
    ]

    let mapped = try NativeWindowInventoryMapper.map(
      windows: windows,
      displays: displays,
      focusedWindowID: "42"
    )

    XCTAssertEqual(mapped.count, 1)
    XCTAssertEqual(mapped[0].display.id, "2")
    XCTAssertEqual(mapped[0].display.scaleFactor, 2)
    XCTAssertEqual(mapped[0].window.bounds, windows[0].frame)
    XCTAssertTrue(mapped[0].focused)
    XCTAssertFalse(mapped[0].minimized)
    XCTAssertEqual(mapped[0].app.bundleId, "com.spark.Editor")
  }

  func testRejectsInvalidGeometryAndCapsTheInventory() throws {
    let display = RawNativeDisplay(
      id: "1",
      pixelWidth: 1_000,
      pixelHeight: 800,
      frame: NativeRect(x: 0, y: 0, width: 1_000, height: 800)
    )
    let invalid = RawNativeWindow(
      id: "1",
      title: "",
      frame: NativeRect(x: 0, y: 0, width: .infinity, height: 100),
      isOnScreen: false,
      processID: 1,
      applicationName: "App",
      bundleID: nil,
      executableIdentity: nil,
      signingIdentity: nil
    )

    XCTAssertEqual(
      try NativeWindowInventoryMapper.map(
        windows: [invalid],
        displays: [display],
        focusedWindowID: nil
      ),
      []
    )
  }

  func testBoundsMetadataByUTF16CodeUnitsWithoutSplittingEmoji() throws {
    let display = RawNativeDisplay(
      id: "1",
      pixelWidth: 1_000,
      pixelHeight: 800,
      frame: NativeRect(x: 0, y: 0, width: 1_000, height: 800)
    )
    let window = RawNativeWindow(
      id: "42",
      title: String(repeating: "😀", count: 2_000),
      frame: NativeRect(x: 0, y: 0, width: 500, height: 400),
      isOnScreen: true,
      processID: 123,
      applicationName: String(repeating: "编辑器😀", count: 200),
      bundleID: "com.spark.Editor",
      executableIdentity: "com.spark.Editor",
      signingIdentity: "ABCDE12345"
    )

    let mapped = try NativeWindowInventoryMapper.map(
      windows: [window],
      displays: [display],
      focusedWindowID: "42"
    )

    XCTAssertEqual(mapped.count, 1)
    XCTAssertLessThanOrEqual(mapped[0].window.title.utf16.count, 2_000)
    XCTAssertLessThanOrEqual(mapped[0].app.name.utf16.count, 300)
    XCTAssertFalse(mapped[0].window.title.contains("�"))
  }

  func testRejectsControlCharactersInNativeMetadata() throws {
    let display = RawNativeDisplay(
      id: "1",
      pixelWidth: 1_000,
      pixelHeight: 800,
      frame: NativeRect(x: 0, y: 0, width: 1_000, height: 800)
    )
    let window = RawNativeWindow(
      id: "42",
      title: "Safe title",
      frame: NativeRect(x: 0, y: 0, width: 500, height: 400),
      isOnScreen: true,
      processID: 123,
      applicationName: "Editor\u{0000}spoofed",
      bundleID: "com.spark.Editor",
      executableIdentity: "com.spark.Editor",
      signingIdentity: "ABCDE12345"
    )

    XCTAssertEqual(
      try NativeWindowInventoryMapper.map(
        windows: [window],
        displays: [display],
        focusedWindowID: "42"
      ),
      []
    )
  }
}
