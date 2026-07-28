import Foundation
import XCTest

@testable import SparkComputerHostCore

final class NativeHostRequestHandlerTests: XCTestCase {
  func testReturnsCapabilitiesWindowInventoryAndDigestBoundCapture() async throws {
    let provider = FakePlatformProvider()
    let handler = NativeHostRequestHandler(provider: provider)

    let capabilities = try await handler.handle(.getCapabilities(requestID: "request-1"))
    XCTAssertNil(capabilities.binary)
    XCTAssertEqual(try responseType(capabilities.json), "capabilities")

    let windows = try await handler.handle(.listWindows(requestID: "request-2"))
    XCTAssertEqual(try responseType(windows.json), "windows")

    let capture = try await handler.handle(
      .captureWindow(requestID: "request-3", snapshotID: "snapshot-1", windowID: "window-1")
    )
    XCTAssertEqual(capture.binary, Data("png".utf8))
    let captureObject = try responseObject(capture.json)
    XCTAssertEqual(captureObject["type"] as? String, "capture_result")
    XCTAssertEqual(
      (captureObject["payload"] as? [String: Any])?["byteLength"] as? Int,
      3
    )
  }

  func testReturnsStableErrorsForPermissionDenialAndUnimplementedControlFeatures() async throws {
    let provider = FakePlatformProvider(captureError: .screenPermissionDenied)
    let handler = NativeHostRequestHandler(provider: provider)
    let denied = try await handler.handle(
      .captureWindow(requestID: "request-1", snapshotID: "snapshot-1", windowID: "window-1")
    )
    XCTAssertEqual(try responseErrorCode(denied.json), "screen_permission_denied")

    let unsupported = try await handler.handle(
      .observe(
        requestID: "request-2", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: true
      )
    )
    XCTAssertEqual(try responseErrorCode(unsupported.json), "environment_unavailable")
  }

  func testReturnsObservationWithAdjacentPngAndExecutesBoundAction() async throws {
    let provider = FakePlatformProvider(controlAvailable: true)
    let handler = NativeHostRequestHandler(provider: provider)
    let observed = try await handler.handle(
      .observe(
        requestID: "request-observe", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: true
      )
    )
    XCTAssertEqual(observed.binary, Data("png".utf8))
    let observation = try responseObject(observed.json)
    XCTAssertEqual(observation["type"] as? String, "observation")
    XCTAssertEqual(
      (observation["observation"] as? [String: Any])?["treeVersion"] as? String,
      "tree-1"
    )

    let action = try executeActionRequest()
    let result = try await handler.handle(action)
    let resultObject = try responseObject(result.json)
    XCTAssertEqual(resultObject["type"] as? String, "action_result")
    XCTAssertEqual(resultObject["actionId"] as? String, "action-1")
    XCTAssertEqual(resultObject["status"] as? String, "executed")
  }

  func testCancelSessionRejectsSubsequentActionsWithoutCallingProvider() async throws {
    let provider = FakePlatformProvider(controlAvailable: true)
    let handler = NativeHostRequestHandler(provider: provider)
    _ = try await handler.handle(
      .cancelSession(requestID: "cancel-request", computerSessionID: "session-1")
    )
    let result = try await handler.handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(result.json), "session_canceled")
    let executeCount = await provider.executeCount()
    XCTAssertEqual(executeCount, 0)
  }

  func testCanceledSessionsRemainDeniedAfterTheRegistryReachesItsCapacityGuard() async throws {
    let provider = FakePlatformProvider(controlAvailable: true)
    let handler = NativeHostRequestHandler(provider: provider)
    _ = try await handler.handle(
      .cancelSession(requestID: "cancel-1", computerSessionID: "session-1")
    )
    for index in 2...10_001 {
      _ = try await handler.handle(
        .cancelSession(
          requestID: "cancel-\(index)", computerSessionID: "session-\(index)")
      )
    }

    let result = try await handler.handle(try executeActionRequest())

    XCTAssertEqual(try responseErrorCode(result.json), "session_canceled")
    let executeCount = await provider.executeCount()
    XCTAssertEqual(executeCount, 0)
  }

  func testAdvertisesControlCapabilitiesOnlyWhenRealBackendsAreAvailable() async throws {
    let available = await FakePlatformProvider(controlAvailable: true).capabilityManifest()
    XCTAssertEqual(available.backends.accessibility, "axui_element")
    XCTAssertEqual(available.backends.input, "cg_event")
    XCTAssertTrue(available.features.fullTree)
    XCTAssertTrue(available.features.diffTree)
    XCTAssertTrue(available.features.semanticActions)
    XCTAssertTrue(available.features.absolutePointer)
    XCTAssertTrue(available.features.keyboard)
    XCTAssertFalse(available.features.clipboard)

    let unavailable = await FakePlatformProvider(controlAvailable: false).capabilityManifest()
    XCTAssertEqual(unavailable.backends.accessibility, "unavailable")
    XCTAssertFalse(unavailable.features.fullTree)
    XCTAssertFalse(unavailable.features.keyboard)
    XCTAssertEqual(unavailable.permissions.input, "not_determined")
  }

  func testMapsStaleFrameAndTreeErrorsWithoutExecutingAResult() async throws {
    let staleFrameProvider = FakePlatformProvider(
      controlAvailable: true, actionError: .staleFrame)
    let frameReply = try await NativeHostRequestHandler(provider: staleFrameProvider)
      .handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(frameReply.json), "stale_frame")

    let staleTreeProvider = FakePlatformProvider(
      controlAvailable: true, actionError: .staleTree)
    let treeReply = try await NativeHostRequestHandler(provider: staleTreeProvider)
      .handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(treeReply.json), "stale_tree")
  }

  func testMapsControlPolicyFailuresToStableWireErrors() async throws {
    let focusProvider = FakePlatformProvider(
      controlAvailable: true, actionControlError: .focusMismatch)
    let focusReply = try await NativeHostRequestHandler(provider: focusProvider)
      .handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(focusReply.json), "focus_mismatch")

    let secureProvider = FakePlatformProvider(
      controlAvailable: true, actionControlError: .sensitiveElement)
    let secureReply = try await NativeHostRequestHandler(provider: secureProvider)
      .handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(secureReply.json), "sensitive_input_blocked")

    let limitProvider = FakePlatformProvider(
      controlAvailable: true, actionControlError: .resourceLimitExceeded)
    let limitReply = try await NativeHostRequestHandler(provider: limitProvider)
      .handle(try executeActionRequest())
    XCTAssertEqual(try responseErrorCode(limitReply.json), "action_not_allowed")
  }

  func testRejectsSchemaInvalidObservationBeforeWritingWireJSON() async throws {
    let provider = FakePlatformProvider(controlAvailable: true, invalidObservation: true)
    let result = try await NativeHostRequestHandler(provider: provider).handle(
      .observe(
        requestID: "request-invalid-observation", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: true
      )
    )
    XCTAssertEqual(try responseErrorCode(result.json), "native_host_incompatible")
    XCTAssertNil(result.binary)
  }

  func testRejectsObservationThatIsNotBoundToRequestedTarget() async throws {
    let provider = FakePlatformProvider(controlAvailable: true, mismatchedObservation: true)
    let result = try await NativeHostRequestHandler(provider: provider).handle(
      .observe(
        requestID: "request-mismatched-observation", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: true
      )
    )
    XCTAssertEqual(try responseErrorCode(result.json), "focus_mismatch")
    XCTAssertNil(result.binary)
  }

  private func executeActionRequest() throws -> NativeHostRequest {
    try NativeHostRequestDecoder().decode(
      Data(
        #"{"protocolVersion":1,"requestId":"request-action","type":"execute_action","envelope":{"computerSessionId":"session-1","actionId":"action-1","actuatorLeaseId":"lease-1","observedFrameId":"frame-1","observedTreeVersion":"tree-1","targetAppId":"app-1","targetWindowId":"window-1","action":{"type":"click","point":{"x":0.5,"y":0.5}},"policyContext":{"effect":"reversible_local","target":{"kind":"window","id":"window-1"},"dataClasses":[]},"intent":"click the button"}}"#
          .utf8
      )
    )
  }

  private func responseType(_ data: Data) throws -> String? {
    try responseObject(data)["type"] as? String
  }

  private func responseErrorCode(_ data: Data) throws -> String? {
    (try responseObject(data)["error"] as? [String: Any])?["code"] as? String
  }

  private func responseObject(_ data: Data) throws -> [String: Any] {
    try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }
}

private actor FakePlatformProvider: NativeHostPlatformProviding {
  private let captureError: NativeHostPlatformError?
  private let controlAvailable: Bool
  private let actionError: NativeHostPlatformError?
  private let actionControlError: NativeControlPolicyError?
  private let invalidObservation: Bool
  private let mismatchedObservation: Bool
  private var executed = 0

  init(
    captureError: NativeHostPlatformError? = nil,
    controlAvailable: Bool = false,
    actionError: NativeHostPlatformError? = nil,
    actionControlError: NativeControlPolicyError? = nil,
    invalidObservation: Bool = false,
    mismatchedObservation: Bool = false
  ) {
    self.captureError = captureError
    self.controlAvailable = controlAvailable
    self.actionError = actionError
    self.actionControlError = actionControlError
    self.invalidObservation = invalidObservation
    self.mismatchedObservation = mismatchedObservation
  }

  func capabilityManifest() -> NativeCapabilityManifest {
    .macosScreenCapture(
      hostVersion: "0.1.0",
      architecture: "arm64",
      screenPermission: captureError == nil ? "granted" : "denied",
      accessibilityPermission: controlAvailable ? "granted" : "not_determined",
      accessibilityAvailable: controlAvailable,
      inputAvailable: controlAvailable
    )
  }

  func listWindows() async throws -> [NativeWindowDescriptor] {
    []
  }

  func captureWindow(id: String) async throws -> NativeCapturedWindow {
    if let captureError { throw captureError }
    return NativeCapturedWindow(bytes: Data("png".utf8), width: 1, height: 1)
  }

  func observe(
    snapshotID: String, appID: String, windowID: String,
    previousTreeVersion: String?, fullTree: Bool
  ) async throws -> NativeObservedWindow {
    guard controlAvailable else { throw NativeHostPlatformError.environmentUnavailable }
    let app = NativeAppIdentity(
      id: mismatchedObservation ? "app-other" : appID, name: "Example", processId: 42,
      bundleId: "com.example.App",
      executableIdentity: "com.example.App", signingIdentity: "TEAM"
    )
    let window = NativeWindowIdentity(
      id: windowID, title: "Window", bounds: NativeRect(x: 0, y: 0, width: 800, height: 600))
    return NativeObservedWindow(
      frameID: invalidObservation ? "" : "frame-1", treeVersion: "tree-1",
      capturedAt: "2026-07-28T12:00:00Z",
      display: NativeDisplayGeometry(id: "display-1", width: 1600, height: 1200, scaleFactor: 2),
      app: app, window: window, snapshotID: snapshotID,
      capture: NativeCapturedWindow(bytes: Data("png".utf8), width: 1, height: 1),
      treeMode: .full, treeText: "[]", elements: [], loading: false, sensitiveRegions: []
    )
  }

  func executeAction(_ envelope: NativeComputerActionEnvelope) async throws -> NativeActionStatus {
    guard controlAvailable else { throw NativeHostPlatformError.environmentUnavailable }
    if let actionError { throw actionError }
    if let actionControlError { throw actionControlError }
    executed += 1
    return .executed
  }

  func executeCount() -> Int { executed }

  func cancelSession(id: String) async {}
}
