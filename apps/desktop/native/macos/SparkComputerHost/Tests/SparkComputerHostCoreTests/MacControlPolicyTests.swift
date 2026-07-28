import Foundation
import XCTest

@testable import SparkComputerHostCore

final class MacControlPolicyTests: XCTestCase {
  func testSanitizesSecureValuesAndPublishesVersionBoundReferences() throws {
    var state = NativeAXTreeState()
    let secure = NativeAXRawElement(
      runtimeID: "secure-runtime",
      role: "AXSecureTextField",
      name: "Password",
      value: "must-never-leak",
      bounds: NativeRect(x: 10, y: 20, width: 100, height: 30),
      enabled: true,
      focused: true,
      actions: ["set_value"],
      secure: true
    )
    let first = state.publish(elements: [secure], previousTreeVersion: nil, fullTree: true)

    XCTAssertEqual(first.mode, .full)
    XCTAssertNil(first.elements[0].value)
    XCTAssertEqual(first.sensitiveRegions, [secure.bounds])
    XCTAssertEqual(first.elements[0].treeVersion, first.treeVersion)
    XCTAssertThrowsError(
      try state.resolve(elementID: first.elements[0].id, treeVersion: "tree-old"))
    XCTAssertThrowsError(
      try state.assertWritable(elementID: first.elements[0].id, treeVersion: first.treeVersion))
  }

  func testDiffIncludesCompleteCurrentReferencesAndInvalidatesOldElements() throws {
    var state = NativeAXTreeState()
    let first = state.publish(
      elements: [element(runtimeID: "one", name: "Before")], previousTreeVersion: nil,
      fullTree: true)
    let second = state.publish(
      elements: [element(runtimeID: "one", name: "After"), element(runtimeID: "two", name: "New")],
      previousTreeVersion: first.treeVersion,
      fullTree: false
    )

    XCTAssertEqual(second.mode, .diff)
    XCTAssertEqual(second.elements.count, 2)
    XCTAssertTrue(second.elements.allSatisfy { $0.treeVersion == second.treeVersion })
    XCTAssertNoThrow(
      try state.resolve(elementID: second.elements[0].id, treeVersion: second.treeVersion))
    XCTAssertThrowsError(
      try state.resolve(elementID: first.elements[0].id, treeVersion: first.treeVersion))

    let forcedFull = state.publish(
      elements: [element(runtimeID: "one", name: "After")],
      previousTreeVersion: "unknown-tree",
      fullTree: false
    )
    XCTAssertEqual(forcedFull.mode, .full)
  }

  func testDuplicateRuntimeIdentifiersCannotCrashOrAliasElementReferences() {
    var state = NativeAXTreeState()
    let snapshot = state.publish(
      elements: [
        element(runtimeID: "duplicate", name: "One"),
        element(runtimeID: "duplicate", name: "Two"),
      ],
      previousTreeVersion: nil,
      fullTree: true
    )
    XCTAssertEqual(snapshot.elements.count, 2)
    XCTAssertEqual(Set(snapshot.elements.map(\.id)).count, 2)
  }

  func testInternalRuntimeIdentifierIsNotTruncatedBeforeResolution() throws {
    let runtimeID = String(repeating: "runtime-path-", count: 30)
    var state = NativeAXTreeState()
    let snapshot = state.publish(
      elements: [element(runtimeID: runtimeID, name: "Long path")],
      previousTreeVersion: nil,
      fullTree: true
    )
    XCTAssertEqual(
      try state.resolve(
        elementID: snapshot.elements[0].id,
        treeVersion: snapshot.treeVersion),
      runtimeID
    )
  }

  func testMapsNormalizedPointsIntoNegativeWindowCoordinates() throws {
    let bounds = NativeRect(x: -1_200, y: -200, width: 800, height: 600)
    XCTAssertEqual(
      try NativeInputPolicy.screenPoint(normalizedX: 0.25, normalizedY: 0.5, windowBounds: bounds),
      NativeScreenPoint(x: -1_000, y: 100)
    )
    XCTAssertThrowsError(
      try NativeInputPolicy.screenPoint(normalizedX: .nan, normalizedY: 0, windowBounds: bounds)
    )
  }

  func testRejectsFocusProcessIdentityDriftSensitiveTargetsAndInputOverflow() throws {
    let expected = NativeTargetIdentity(
      appID: "app-1", windowID: "window-1", processID: 10, bundleID: "com.example.App",
      executableIdentity: "com.example.App", signingIdentity: "TEAM", focused: true,
      windowBounds: NativeRect(x: 0, y: 0, width: 800, height: 600)
    )
    var drifted = expected
    drifted.processID = 11
    XCTAssertThrowsError(
      try NativeInputPolicy.validateIdentity(expected: expected, current: drifted))
    XCTAssertThrowsError(try NativeInputPolicy.validateText(String(repeating: "😀", count: 50_001)))
    XCTAssertThrowsError(try NativeInputPolicy.validateKeys(Array(repeating: "A", count: 9)))
    XCTAssertTrue(NativeInputPolicy.keypressCanModifySecureField(["A"]))
    XCTAssertTrue(NativeInputPolicy.keypressCanModifySecureField(["Backspace"]))
    XCTAssertFalse(NativeInputPolicy.keypressCanModifySecureField(["Shift", "Tab"]))
    XCTAssertTrue(
      NativeInputPolicy.isSensitiveTarget(appName: "1Password", bundleID: "com.1password.1password")
    )
    XCTAssertTrue(
      NativeInputPolicy.isSensitiveTarget(
        appName: "SecurityAgent", bundleID: "com.apple.SecurityAgent"))
  }

  func testRejectsWindowGeometryDriftBeforeOrAfterCoordinateInput() throws {
    let expected = NativeTargetIdentity(
      appID: "app-1", windowID: "window-1", processID: 10, bundleID: "com.example.App",
      executableIdentity: "com.example.App", signingIdentity: "TEAM", focused: true,
      windowBounds: NativeRect(x: 0, y: 0, width: 800, height: 600)
    )
    let moved = NativeTargetIdentity(
      appID: "app-1", windowID: "window-1", processID: 10, bundleID: "com.example.App",
      executableIdentity: "com.example.App", signingIdentity: "TEAM", focused: true,
      windowBounds: NativeRect(x: 120, y: 0, width: 800, height: 600)
    )

    XCTAssertThrowsError(
      try NativeInputPolicy.validateIdentity(expected: expected, current: moved))
  }

  private func element(runtimeID: String, name: String) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID,
      role: "AXButton",
      name: name,
      value: nil,
      bounds: NativeRect(x: 0, y: 0, width: 100, height: 30),
      enabled: true,
      focused: false,
      actions: ["invoke"],
      secure: false
    )
  }
}
