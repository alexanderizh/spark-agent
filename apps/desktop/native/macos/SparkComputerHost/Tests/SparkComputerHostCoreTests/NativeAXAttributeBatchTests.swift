import ApplicationServices
import XCTest

@testable import SparkComputerHostCore

final class NativeAXAttributeBatchTests: XCTestCase {
  func testNormalizeDropsNullAndErrorValuesButKeepsRealOnes() {
    var errorValue: AXError = .cannotComplete
    var range = CFRange(location: 0, length: 3)
    let errorAXValue = AXValueCreate(.axError, &errorValue)
    let rangeAXValue = AXValueCreate(.cfRange, &range)

    let normalized = NativeAXAttributeBatch.normalize([
      "Settings" as NSString,
      NSNull(),
      errorAXValue as Any,
      rangeAXValue as Any,
      42 as NSNumber,
    ])

    XCTAssertEqual(normalized.count, 5)
    XCTAssertEqual(normalized[0] as? String, "Settings")
    // "The returned array can contain an error or CFNull at the corresponding
    // position" (AXUIElement.h) — both must read as "no value".
    XCTAssertNil(normalized[1])
    if errorAXValue != nil {
      XCTAssertNil(normalized[2])
    }
    // A real AXValue (position/size/range) must survive normalization.
    XCTAssertNotNil(normalized[3])
    XCTAssertEqual(normalized[4] as? NSNumber, 42)
  }

  func testReaderMirrorsTypedSingleAttributeLookups() {
    let reader = NativeAXAttributeReader(
      names: ["AXRole", "AXEnabled", "AXTitle", "AXValue"],
      values: ["AXButton", NSNumber(value: true), NSNull(), "Save"])

    XCTAssertEqual(reader.string("AXRole"), "AXButton")
    XCTAssertNil(reader.string("AXTitle"))
    XCTAssertEqual(reader.bool("AXEnabled"), true)
    XCTAssertEqual(reader.number("AXEnabled"), NSNumber(value: true))
    XCTAssertEqual(reader.string("AXValue"), "Save")
    // A value used as the wrong type reads as absent, exactly like `as? Value`.
    XCTAssertNil(reader.number("AXRole"))
    XCTAssertNil(reader.string("AXMissing"))
  }

  func testDeclarationOrderMatchesTheDocumentedAttributeSet() {
    // The batched call reports values positionally, so the order is part of the
    // contract: the reader is built from these arrays.
    XCTAssertTrue(NativeAXAttributeBatch.identityAttributes.contains("AXChildren"))
    XCTAssertTrue(NativeAXAttributeBatch.identityAttributes.contains("AXPosition"))
    XCTAssertTrue(NativeAXAttributeBatch.contentAttributes.contains("AXValue"))
    XCTAssertTrue(NativeAXAttributeBatch.contentAttributes.contains("AXProtectedContent"))
    XCTAssertEqual(NativeAXAttributeBatch.placeholderAttributes, ["AXPlaceholderValue"])
    XCTAssertEqual(NativeAXAttributeBatch.selectionAttributes, ["AXSelected"])
  }
}

final class NativeAXChildSourcesTests: XCTestCase {
  func testRowBearingRolesGetTheRowsFallbackAndOthersDoNot() {
    // Measured: an AXColumn with an empty AXChildren carried 27 rows in AXRows,
    // so an entire table column was invisible without this fallback.
    for role in ["AXTable", "AXOutline", "AXList", "AXColumn", "AXRow", "AXBrowser", "AXGrid"] {
      XCTAssertEqual(
        NativeAXChildSources.candidates(forRole: role), ["AXChildren", "AXRows"], role)
    }
    for role in ["AXGroup", "AXWindow", "AXWebArea", "AXScrollArea", "AXButton"] {
      XCTAssertEqual(NativeAXChildSources.candidates(forRole: role), ["AXChildren"], role)
    }
  }

  func testVisibleChildrenIsNeverAFallback() {
    // Apple documents AXVisibleChildren as a SUBSET of AXChildren, so using it
    // as a fallback could only ever hide content we can already read.
    for role in NativeAXChildSources.rowBearingRoles {
      XCTAssertFalse(
        NativeAXChildSources.candidates(forRole: role).contains("AXVisibleChildren"))
    }
  }
}
