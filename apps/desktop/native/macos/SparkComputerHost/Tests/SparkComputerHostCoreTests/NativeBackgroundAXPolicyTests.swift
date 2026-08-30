import XCTest

@testable import SparkComputerHostCore

final class NativeBackgroundAXPolicyTests: XCTestCase {
  // MARK: - NativeAXHitTest

  func testHitTestSelectsSmallestAreaContainingElement() {
    let elements = [
      element(id: "outer", bounds: NativeRect(x: 0, y: 0, width: 800, height: 600), actions: ["invoke"]),
      element(id: "mid", bounds: NativeRect(x: 100, y: 100, width: 400, height: 300), actions: []),
      element(id: "inner", bounds: NativeRect(x: 150, y: 150, width: 100, height: 50), actions: ["invoke"]),
    ]
    let hit = NativeAXHitTest.target(
      at: NativeScreenPoint(x: 160, y: 160), in: elements, capability: .pressable)
    XCTAssertEqual(hit?.id, "inner")
  }

  func testHitTestIgnoresElementsWithoutTheRequestedCapability() {
    let elements = [
      element(id: "small-static", bounds: NativeRect(x: 0, y: 0, width: 10, height: 10), actions: ["focus"]),
      element(id: "big-button", bounds: NativeRect(x: 0, y: 0, width: 800, height: 600), actions: ["invoke"]),
    ]
    let hit = NativeAXHitTest.target(
      at: NativeScreenPoint(x: 5, y: 5), in: elements, capability: .pressable)
    XCTAssertEqual(hit?.id, "big-button")
  }

  func testHitTestReturnsNilWhenPointOutsideEveryElement() {
    let elements = [
      element(id: "button", bounds: NativeRect(x: 0, y: 0, width: 100, height: 100), actions: ["invoke"]),
    ]
    XCTAssertNil(
      NativeAXHitTest.target(
        at: NativeScreenPoint(x: 150, y: 150), in: elements, capability: .pressable))
  }

  func testHitTestMatchesBoundaryCoordinatesOnEveryEdge() {
    let bounds = NativeRect(x: 10, y: 10, width: 100, height: 100)
    let elements = [element(id: "edge", bounds: bounds, actions: ["invoke"])]
    for point in [
      NativeScreenPoint(x: 10, y: 10),
      NativeScreenPoint(x: 110, y: 10),
      NativeScreenPoint(x: 10, y: 110),
      NativeScreenPoint(x: 110, y: 110),
    ] {
      XCTAssertEqual(
        NativeAXHitTest.target(at: point, in: elements, capability: .pressable)?.id,
        "edge", "closed containment should hit element edges")
    }
    XCTAssertNil(
      NativeAXHitTest.target(
        at: NativeScreenPoint(x: 111, y: 50), in: elements, capability: .pressable))
  }

  func testHitTestCapabilityMatrix() {
    XCTAssertTrue(NativeAXHitTest.supports(.pressable, actions: ["invoke"]))
    XCTAssertTrue(NativeAXHitTest.supports(.pressable, actions: ["select"]))
    XCTAssertFalse(NativeAXHitTest.supports(.pressable, actions: ["set_value"]))
    XCTAssertTrue(NativeAXHitTest.supports(.scrollable, actions: ["scroll"]))
    XCTAssertFalse(NativeAXHitTest.supports(.scrollable, actions: ["invoke"]))
    XCTAssertTrue(NativeAXHitTest.supports(.textInput, actions: ["set_value"]))
    XCTAssertFalse(NativeAXHitTest.supports(.textInput, actions: []))
  }

  func testHitTestIgnoresNonFinitePoints() {
    let elements = [element(id: "button", bounds: NativeRect(x: 0, y: 0, width: 10, height: 10), actions: ["invoke"])]
    XCTAssertNil(
      NativeAXHitTest.target(
        at: NativeScreenPoint(x: .nan, y: 5), in: elements, capability: .pressable))
    XCTAssertNil(
      NativeAXHitTest.target(
        at: NativeScreenPoint(x: 5, y: .infinity), in: elements, capability: .pressable))
  }

  // MARK: - NativeBackgroundActionPolicy

  func testOnlyCoordinateActionsAreEligibleForBackgroundAX() {
    func action(_ raw: String) -> NativeComputerAction {
      try! decodeActionForTest(raw)
    }
    XCTAssertTrue(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"click","point":{"x":0.5,"y":0.5}}"#)))
    XCTAssertTrue(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"scroll","deltaX":0,"deltaY":120}"#)))
    XCTAssertTrue(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"type_text","text":"hi"}"#)))
    XCTAssertFalse(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"move","point":{"x":0.5,"y":0.5}}"#)))
    XCTAssertFalse(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"drag","from":{"x":0,"y":0},"to":{"x":1,"y":1}}"#)))
    XCTAssertFalse(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"keypress","keys":["Meta","C"]}"#)))
    XCTAssertFalse(NativeBackgroundActionPolicy.isEligible(action(#"{"type":"invoke_element","elementId":"element-1"}"#)))
  }

  func testSensitiveAndCanceledErrorsAbortInsteadOfDegradingToForeground() {
    XCTAssertTrue(NativeBackgroundActionPolicy.mustAbort(.sensitiveInputBlocked))
    XCTAssertTrue(NativeBackgroundActionPolicy.mustAbort(.sessionCanceled))
    for recoverable: NativeHostPlatformError in [
      .staleTree, .actionNoop, .actionNotAllowed, .focusMismatch, .staleFrame,
    ] {
      XCTAssertFalse(
        NativeBackgroundActionPolicy.mustAbort(recoverable),
        "\(recoverable) must degrade to the foreground HID path")
    }
  }

  func testScrollStepCountIsBoundedAndDeltaProportional() {
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: 0), 0)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: 60), 1)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: -120), 1)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: 240), 2)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: -600), 5)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: 100_000), 20)
    XCTAssertEqual(NativeBackgroundActionPolicy.scrollStepCount(forDelta: .nan), 0)
  }

  func testShiftedSymbolKeysAreAcceptedByKeypressDecoder() throws {
    let action = try decodeActionForTest(#"{"type":"keypress","keys":["Shift","!"]}"#)
    guard case .keypress(let keys) = action else {
      return XCTFail("expected keypress action")
    }
    XCTAssertEqual(keys, ["Shift", "!"])
    XCTAssertThrowsError(try decodeActionForTest(#"{"type":"keypress","keys":["§"]}"#))
  }

  // MARK: - NativeKeySymbols

  func testShiftedSymbolsCoverTheUSLayoutSet() {
    let expected: Set<String> = [
      "~", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
      "_", "+", "{", "}", ":", "\"", "<", ">", "?", "|",
    ]
    XCTAssertEqual(Set(NativeKeySymbols.shiftedToBase.keys), expected)
    for (symbol, base) in NativeKeySymbols.shiftedToBase {
      XCTAssertEqual(NativeKeySymbols.baseCharacter(for: symbol), base)
      XCTAssertTrue(NativeKeySymbols.isShiftedSymbol(symbol))
      XCTAssertFalse(NativeKeySymbols.isShiftedSymbol(base))
    }
  }

  // MARK: -

  private func element(
    id: String,
    bounds: NativeRect,
    actions: [String],
    role: String = "AXButton"
  ) -> NativeAXElementRef {
    NativeAXElementRef(
      id: id, treeVersion: "tree-test", role: role, name: id, value: nil,
      bounds: bounds, enabled: true, focused: false, actions: actions)
  }

  private func decodeActionForTest(_ json: String) throws -> NativeComputerAction {
    // Reuse the wire decoder through a full envelope parse so the same validation rules
    // that gate real keypress/click payloads gate this policy test.
    let envelopeJSON = """
      {"computerSessionId":"session","actionId":"action","actuatorLeaseId":"lease",\
      "observedFrameId":"frame","observedTreeVersion":"tree","targetAppId":"app",\
      "targetWindowId":"window","action":\(json),\
      "policyContext":{"effect":"reversible_local","target":{"kind":"window","id":"window"},"dataClasses":[]},\
      "intent":"test"}
      """
    let object = try JSONSerialization.jsonObject(with: Data(envelopeJSON.utf8), options: [])
    return try decodeComputerActionEnvelope(object).action
  }
}
