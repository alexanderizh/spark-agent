import XCTest

@testable import SparkComputerHostCore

final class NativeWebTreeReadinessTests: XCTestCase {
  // MARK: - hasWebContent

  func testDetectsDocumentContainerWithContent() {
    let elements = [
      element(role: "AXWindow", name: "SparkWork", depth: 0),
      element(role: "AXGroup", name: "", depth: 1),
      element(role: "AXWebArea", name: "SparkWork", depth: 2),
      element(role: "AXButton", name: "返回工作台", depth: 3),
    ]
    XCTAssertTrue(NativeWebTreeReadiness.hasWebContent(elements))
  }

  func testEmptyDocumentContainerDoesNotCountAsContent() {
    // Measured shape: Chromium exposes a 1x1 empty AXWebArea while the page is
    // still assembling, so a bare role match would declare the tree ready
    // exactly when it is least complete.
    let elements = [
      element(role: "AXWindow", name: "Edge", depth: 0),
      element(role: "AXWebArea", name: "", depth: 1),
      element(role: "AXButton", name: "Reload", depth: 1),
    ]
    XCTAssertFalse(NativeWebTreeReadiness.hasWebContent(elements))
  }

  func testSiblingAfterDocumentContainerIsNotItsContent() {
    let elements = [
      element(role: "AXWebArea", name: "", depth: 1),
      element(role: "AXButton", name: "Reload", depth: 1),
    ]
    XCTAssertFalse(NativeWebTreeReadiness.hasWebContent(elements))
  }

  func testWindowShellAloneHasNoWebContent() {
    // The exact shape a mistimed first traversal produces: window + traffic
    // lights, 4 lines in the outline.
    let elements = [
      element(role: "AXWindow", name: "WorkBuddy", depth: 0),
      element(role: "AXButton", name: "关闭按钮", depth: 1),
      element(role: "AXButton", name: "全屏幕按钮", depth: 1),
      element(role: "AXButton", name: "最小化按钮", depth: 1),
    ]
    XCTAssertFalse(NativeWebTreeReadiness.hasWebContent(elements))
  }

  // MARK: - shouldRetry

  func testRetriesShellOnlyTreeOfAChromiumApp() {
    let shell = [element(role: "AXWindow", name: "WorkBuddy", depth: 0)]
    XCTAssertTrue(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: shell, attempts: 0,
        webTreeSeenForProcess: false))
  }

  func testNeverRetriesNativeAppsThatRejectTheHandshake() {
    // Finder answers AXError.attributeUnsupported, so it never builds a web
    // tree and waiting for one would only slow every observation down.
    let shell = [element(role: "AXWindow", name: "访达", depth: 0)]
    XCTAssertFalse(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: false, elements: shell, attempts: 0,
        webTreeSeenForProcess: false))
  }

  func testStopsRetryingOnceTheTreeIsReady() {
    let ready = [
      element(role: "AXWindow", name: "SparkWork", depth: 0),
      element(role: "AXWebArea", name: "SparkWork", depth: 1),
      element(role: "AXButton", name: "通用", depth: 2),
    ]
    XCTAssertFalse(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: ready, attempts: 0,
        webTreeSeenForProcess: false))
  }

  func testStopsRetryingWhenTheProcessAlreadyExposedAWebTree() {
    let shell = [element(role: "AXWindow", name: "WorkBuddy", depth: 0)]
    XCTAssertFalse(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: shell, attempts: 0,
        webTreeSeenForProcess: true))
  }

  func testDoesNotRetryALargeTreeWithoutADocumentContainer() {
    // A big native (non-web) window inside an Electron app is not an unfinished
    // build; waiting for an AXWebArea that will never appear wastes ~1.8 s.
    let large = (0..<NativeWebTreeReadiness.shellElementBudget + 1).map {
      element(role: "AXButton", name: "row \($0)", depth: 1)
    }
    XCTAssertFalse(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: large, attempts: 0,
        webTreeSeenForProcess: false))
  }

  func testRetryScheduleIsBounded() {
    let shell = [element(role: "AXWindow", name: "WorkBuddy", depth: 0)]
    XCTAssertTrue(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: shell,
        attempts: NativeWebTreeReadiness.retryDelaysMs.count - 1,
        webTreeSeenForProcess: false))
    XCTAssertFalse(
      NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: true, elements: shell,
        attempts: NativeWebTreeReadiness.retryDelaysMs.count,
        webTreeSeenForProcess: false))
  }

  private func element(role: String, name: String, depth: Int) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: "\(role)-\(name)-\(depth)", role: role, name: name, value: nil,
      bounds: NativeRect(x: 0, y: 0, width: 100, height: 30), enabled: true,
      focused: false, actions: [], secure: false, depth: depth)
  }
}
