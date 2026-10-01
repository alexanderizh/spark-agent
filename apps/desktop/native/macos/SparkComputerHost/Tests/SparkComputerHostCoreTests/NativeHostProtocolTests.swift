import Foundation
import XCTest

@testable import SparkComputerHostCore

final class NativeHostProtocolTests: XCTestCase {
  func testDecodesOnlyVersionedStrictRequests() throws {
    let decoder = NativeHostRequestDecoder()

    XCTAssertEqual(
      try decoder.decode(
        json(#"{"protocolVersion":1,"requestId":"request-1","type":"get_capabilities"}"#)),
      .getCapabilities(requestID: "request-1")
    )
    XCTAssertEqual(
      try decoder.decode(
        json(
          #"{"protocolVersion":1,"requestId":"request-2","type":"capture_window","snapshotId":"snapshot-1","windowId":"window-1"}"#
        )),
      .captureWindow(requestID: "request-2", snapshotID: "snapshot-1", windowID: "window-1")
    )
    XCTAssertEqual(
      try decoder.decode(
        json(
          #"{"protocolVersion":1,"requestId":"request-3","type":"request_permissions","permissions":["screen","accessibility"]}"#
        )),
      .requestPermissions(requestID: "request-3", permissions: [.screen, .accessibility])
    )
    XCTAssertEqual(
      try decoder.decode(
        json(
          #"{"protocolVersion":1,"requestId":"request-observe","type":"observe","snapshotId":"snapshot-1","appId":"app-1","windowId":"window-1","previousTreeVersion":null,"fullTree":false,"persistentCapture":true,"recordBinding":false}"#
        )),
      .observe(
        requestID: "request-observe", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: false,
        persistentCapture: true, recordBinding: false
      )
    )
    // One-shot inspection form: recordBinding alone (no persistentCapture) is a
    // valid combination, and its absence still defaults to owning the binding.
    XCTAssertEqual(
      try decoder.decode(
        json(
          #"{"protocolVersion":1,"requestId":"request-observe","type":"observe","snapshotId":"snapshot-1","appId":"app-1","windowId":"window-1","previousTreeVersion":null,"fullTree":false,"recordBinding":false}"#
        )),
      .observe(
        requestID: "request-observe", snapshotID: "snapshot-1", appID: "app-1",
        windowID: "window-1", previousTreeVersion: nil, fullTree: false,
        persistentCapture: false, recordBinding: false
      )
    )
    XCTAssertThrowsError(
      try decoder.decode(
        json(
          #"{"protocolVersion":1,"requestId":"request-3","type":"request_permissions","permissions":["screen","screen"]}"#
        ))
    )
    XCTAssertThrowsError(
      try decoder.decode(json(#"{"protocolVersion":2,"requestId":"request-1","type":"ping"}"#))
    )
    XCTAssertThrowsError(
      try decoder.decode(
        json(#"{"protocolVersion":1,"requestId":"request-1","type":"ping","extra":true}"#))
    )
    XCTAssertThrowsError(
      try decoder.decode(json(#"{"protocolVersion":1,"requestId":"request-1","type":"run_shell"}"#))
    )
  }

  func testEncodesSchemaCompatibleCapabilitiesAndErrors() throws {
    let manifest = NativeCapabilityManifest.macosScreenCapture(
      hostVersion: "0.1.0",
      architecture: "arm64",
      screenPermission: "granted"
    )
    let capabilities = try NativeHostResponseEncoder.capabilities(
      requestID: "request-1",
      manifest: manifest
    )
    let decoded = try XCTUnwrap(
      JSONSerialization.jsonObject(with: capabilities) as? [String: Any]
    )

    XCTAssertEqual(decoded["protocolVersion"] as? Int, 1)
    XCTAssertEqual(decoded["requestId"] as? String, "request-1")
    XCTAssertEqual(decoded["type"] as? String, "capabilities")
    XCTAssertNotNil(decoded["manifest"] as? [String: Any])

    let listOnly = NativeCapabilityManifest.macosScreenCapture(
      hostVersion: "0.1.0",
      architecture: "arm64",
      screenPermission: "not_determined",
      accessibilityPermission: "granted",
      captureWindowSupported: false
    )
    XCTAssertFalse(listOnly.features.captureWindow)
    XCTAssertEqual(listOnly.permissions.accessibility, "granted")

    let independentInputPermission = NativeCapabilityManifest.macosScreenCapture(
      hostVersion: "0.1.0",
      architecture: "arm64",
      screenPermission: "granted",
      accessibilityPermission: "granted",
      inputPermission: "not_determined",
      accessibilityAvailable: true,
      inputAvailable: false
    )
    XCTAssertEqual(independentInputPermission.permissions.accessibility, "granted")
    XCTAssertEqual(independentInputPermission.permissions.input, "not_determined")
    XCTAssertEqual(independentInputPermission.backends.input, "unavailable")

    let error = try NativeHostResponseEncoder.error(
      requestID: "request-2",
      code: "screen_permission_denied",
      message: "Screen Recording permission is required",
      retryable: true
    )
    let errorObject = try XCTUnwrap(
      JSONSerialization.jsonObject(with: error) as? [String: Any]
    )
    XCTAssertEqual(
      (errorObject["error"] as? [String: Any])?["code"] as? String, "screen_permission_denied")
  }

  func testStrictlyDecodesEveryComputerActionEnvelopeVariant() throws {
    let decoder = NativeHostRequestDecoder()
    let actions = [
      #"{"type":"observe","fullTree":true}"#,
      #"{"type":"invoke_element","elementId":"element-1","action":"invoke"}"#,
      #"{"type":"set_value","elementId":"element-1","value":"value","sensitive":false}"#,
      #"{"type":"select_text","elementId":"element-1","text":"needle","prefix":"pre","suffix":"post"}"#,
      #"{"type":"click","point":{"x":0.25,"y":1},"button":"right","count":2}"#,
      #"{"type":"move","point":{"x":0,"y":0.5}}"#,
      #"{"type":"drag","from":{"x":0,"y":0},"to":{"x":1,"y":1},"durationMs":50}"#,
      #"{"type":"scroll","elementId":"element-1","point":{"x":0.5,"y":0.5},"deltaX":1,"deltaY":-2}"#,
      #"{"type":"keypress","keys":["Meta","A","F24"]}"#,
      #"{"type":"type_text","text":"hello","sensitive":true}"#,
      #"{"type":"wait_for","condition":{"kind":"element_present","elementId":"element-1"},"timeoutMs":1000}"#,
      #"{"type":"focus_window","windowId":"window-1"}"#,
    ]

    for (index, action) in actions.enumerated() {
      let request = try decoder.decode(actionRequest(action, requestID: "request-\(index)"))
      guard case .executeAction(_, let envelope) = request else {
        return XCTFail("expected execute_action")
      }
      XCTAssertEqual(envelope.action.type, actionType(action))
    }
  }

  func testRejectsUnknownMissingAndUnsafeEnvelopeFields() throws {
    let decoder = NativeHostRequestDecoder()
    let valid = #"{"type":"click","point":{"x":0.5,"y":0.5}}"#
    let invalidActions = [
      #"{"type":"click","point":{"x":1.01,"y":0.5}}"#,
      #"{"type":"click","point":{"x":0.5,"y":0.5},"shell":"id"}"#,
      #"{"type":"scroll","deltaX":0,"deltaY":0}"#,
      #"{"type":"keypress","keys":[]}"#,
      #"{"type":"keypress","keys":["Command"]}"#,
      #"{"type":"keypress","keys":["F01"]}"#,
      #"{"type":"type_text","text":""}"#,
      #"{"type":"wait_for","condition":{"kind":"window_focused","windowId":"window-1"},"timeoutMs":49}"#,
    ]
    for action in invalidActions {
      XCTAssertThrowsError(try decoder.decode(actionRequest(action)))
    }

    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: actionRequest(valid)) as? [String: Any]
    )
    var envelope = try XCTUnwrap(object["envelope"] as? [String: Any])
    envelope["eval"] = "danger"
    var unknownEnvelope = object
    unknownEnvelope["envelope"] = envelope
    XCTAssertThrowsError(
      try decoder.decode(try JSONSerialization.data(withJSONObject: unknownEnvelope)))

    envelope.removeValue(forKey: "actionId")
    var missingEnvelope = object
    missingEnvelope["envelope"] = envelope
    XCTAssertThrowsError(
      try decoder.decode(try JSONSerialization.data(withJSONObject: missingEnvelope)))

    let longIdentifier = String(repeating: "😀", count: 101)
    var oversized = object
    var oversizedEnvelope = try XCTUnwrap(oversized["envelope"] as? [String: Any])
    oversizedEnvelope["actionId"] = longIdentifier
    oversized["envelope"] = oversizedEnvelope
    XCTAssertThrowsError(try decoder.decode(try JSONSerialization.data(withJSONObject: oversized)))
  }

  func testExecutionLaneMustMatchTheActionKind() throws {
    let decoder = NativeHostRequestDecoder()

    var foreground = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: actionRequest(#"{"type":"click","point":{"x":0.5,"y":0.5}}"#)
      ) as? [String: Any]
    )
    var foregroundEnvelope = try XCTUnwrap(foreground["envelope"] as? [String: Any])
    foregroundEnvelope["executionLane"] = "foreground_input"
    foreground["envelope"] = foregroundEnvelope
    XCTAssertNoThrow(try decoder.decode(try JSONSerialization.data(withJSONObject: foreground)))

    foregroundEnvelope["executionLane"] = "background_semantic"
    foreground["envelope"] = foregroundEnvelope
    XCTAssertThrowsError(try decoder.decode(try JSONSerialization.data(withJSONObject: foreground)))

    var background = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: actionRequest(#"{"type":"set_value","elementId":"field-1","value":"ok"}"#)
      ) as? [String: Any]
    )
    var backgroundEnvelope = try XCTUnwrap(background["envelope"] as? [String: Any])
    backgroundEnvelope["executionLane"] = "background_semantic"
    background["envelope"] = backgroundEnvelope
    XCTAssertNoThrow(try decoder.decode(try JSONSerialization.data(withJSONObject: background)))
  }

  func testRejectsInvalidExpectedPostconditionAndPolicyContext() throws {
    let decoder = NativeHostRequestDecoder()
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(
        with: actionRequest(#"{"type":"observe"}"#)
      ) as? [String: Any]
    )
    var envelope = try XCTUnwrap(object["envelope"] as? [String: Any])
    envelope["expectedPostcondition"] = [
      "kind": "file", "path": "/tmp/escape", "assertion": ["operator": "exists", "expected": true],
    ]
    var invalidPostcondition = object
    invalidPostcondition["envelope"] = envelope
    XCTAssertThrowsError(
      try decoder.decode(try JSONSerialization.data(withJSONObject: invalidPostcondition)))

    envelope.removeValue(forKey: "expectedPostcondition")
    envelope["policyContext"] = [
      "effect": "read_only",
      "target": ["kind": "application", "id": "app-1"],
      "dataClasses": ["public", "public"],
    ]
    var duplicateClasses = object
    duplicateClasses["envelope"] = envelope
    XCTAssertThrowsError(
      try decoder.decode(try JSONSerialization.data(withJSONObject: duplicateClasses)))
  }

  private func actionRequest(_ action: String, requestID: String = "request-action") -> Data {
    Data(
      """
      {"protocolVersion":1,"requestId":"\(requestID)","type":"execute_action","envelope":{"computerSessionId":"session-1","actionId":"action-1","actuatorLeaseId":"lease-1","observedFrameId":"frame-1","observedTreeVersion":"tree-1","targetAppId":"app-1","targetWindowId":"window-1","action":\(action),"policyContext":{"effect":"read_only","target":{"kind":"application","id":"app-1"},"dataClasses":["public"]},"intent":"test action"}}
      """.utf8
    )
  }

  private func actionType(_ action: String) -> String {
    let data = Data(action.utf8)
    guard let raw = try? JSONSerialization.jsonObject(with: data),
      let object = raw as? [String: Any]
    else { return "" }
    return object["type"] as? String ?? ""
  }

  private func json(_ value: String) -> Data {
    Data(value.utf8)
  }
}

final class NativeSkyshotProtocolTests: XCTestCase {
  private func json(_ value: String) -> Data {
    Data(value.utf8)
  }

  func testDecodesIncludeSkyshotEnvelopeField() throws {
    let decoder = NativeHostRequestDecoder()
    let request = try decoder.decode(
      json(
        #"{"protocolVersion":1,"requestId":"r1","type":"execute_action","envelope":{"computerSessionId":"cs","actionId":"a1","actuatorLeaseId":"lease","observedFrameId":"f1","observedTreeVersion":"t1","targetAppId":"app","targetWindowId":"win","action":{"type":"click","point":{"x":0.5,"y":0.5}},"policyContext":{"effect":"reversible_local","target":{"kind":"window","id":"win"},"dataClasses":["public"]},"intent":"click the button","includeSkyshot":true}}"#
      ))
    guard case .executeAction(_, let envelope) = request else {
      return XCTFail("expected execute_action request")
    }
    XCTAssertTrue(envelope.includeSkyshot)
  }

  func testEncodesActionResultWithSkyshotFields() throws {
    let observed = NativeObservedWindow(
      frameID: "frame-x",
      treeVersion: "tree-x",
      capturedAt: "2026-09-05T00:00:00Z",
      display: NativeDisplayGeometry(id: "d", width: 1, height: 1, scaleFactor: 2),
      app: NativeAppIdentity(
        id: "app", name: "App", processId: 42, bundleId: nil, executableIdentity: nil,
        signingIdentity: nil),
      window: NativeWindowIdentity(
        id: "win", title: "Window",
        bounds: NativeRect(x: 0, y: 0, width: 100, height: 100)),
      snapshotID: "snap",
      capture: NativeCapturedWindow(bytes: Data([1, 2, 3]), width: 4, height: 4),
      treeMode: .full,
      treeText: "- window \"W\" [1]",
      elements: [
        NativeAXElementRef(
          id: "1", treeVersion: "tree-x", role: "AXWindow", name: "W", value: nil,
          bounds: NativeRect(x: 0, y: 0, width: 100, height: 100), enabled: true, focused: false,
          actions: ["focus"])
      ],
      loading: false,
      sensitiveRegions: []
    )
    let data = try NativeHostResponseEncoder.actionResult(
      requestID: "r1",
      actionID: "a1",
      execution: NativeActionExecution(
        status: .executed, executionChannel: .backgroundPID, skyshot: observed)
    )
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    XCTAssertEqual(object?["skyshot"] as? [String: Any] != nil, true)
    let skyshot = object?["skyshot"] as? [String: Any]
    XCTAssertEqual(skyshot?["frameId"] as? String, "frame-x")
    XCTAssertEqual((skyshot?["elements"] as? [Any])?.count, 1)
    XCTAssertEqual(object?["executionChannel"] as? String, "background_pid")
    let payload = object?["payload"] as? [String: Any]
    XCTAssertEqual(payload?["kind"] as? String, "image_png")
    XCTAssertEqual(payload?["byteLength"] as? Int, 3)
  }

  func testEncodesActionResultWithoutSkyshotOmitsFields() throws {
    let data = try NativeHostResponseEncoder.actionResult(
      requestID: "r1",
      actionID: "a1",
      execution: NativeActionExecution(status: .executed, executionChannel: .foregroundCG)
    )
    let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    XCTAssertNil(object?["skyshot"])
    XCTAssertNil(object?["payload"])
  }
}

/// Regression cover for "an error reply must never be able to kill the host".
///
/// Measured failure: a locked screen produced `code: "screen_locked"` from the
/// platform-error mapper, `NativeHostResponseEncoder.error` rejected it (the code
/// was missing from the allow-list) and threw, the throw escaped
/// `NativeHostRequestHandler.handle`, and `HostMain` treated it as a protocol
/// failure and exited the process — burning the session's single host-restart
/// budget instead of reporting a lock the model could wait out.
final class NativeHostRequestDecodingTests: XCTestCase {
  private func payload(_ json: String) -> Data { Data(json.utf8) }

  func testAnswersAMalformedRequestWithoutEndingTheSession() throws {
    // Measured: a probe that omitted appId/windowId made the host exit(76) and
    // the caller wait for its timeout. The frame boundary was honored, so the
    // only correct reaction is one error reply and a live host.
    let data = payload(#"{"protocolVersion":1,"requestId":"r7","type":"observe"}"#)
    let reply = try NativeHostRequestDecoding.errorReply(
      for: data, error: .invalidRequestFields)
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: reply) as? [String: Any])
    XCTAssertEqual(object["type"] as? String, "error")
    XCTAssertEqual(object["requestId"] as? String, "r7")
    let body = try XCTUnwrap(object["error"] as? [String: Any])
    XCTAssertEqual(body["code"] as? String, "invalid_request")
    XCTAssertEqual(body["retryable"] as? Bool, false)
    XCTAssertTrue(
      allowedErrorCodes.contains("invalid_request"),
      "a code the host can emit must be in the contract's allowed set")
  }

  func testUsesTheRequestIDEvenWhenTheFieldsAreWrong() {
    XCTAssertEqual(
      NativeHostRequestDecoding.requestID(
        in: payload(#"{"protocolVersion":9,"requestId":"abc-1","type":"ping"}"#)),
      "abc-1")
  }

  func testFallsBackToUnknownWhenTheRequestIDIsUnusable() {
    // No requestId, an unusable one, and plain garbage all have to produce a
    // reply the caller can parse.
    XCTAssertEqual(NativeHostRequestDecoding.requestID(in: payload("{}")), "unknown")
    XCTAssertEqual(
      NativeHostRequestDecoding.requestID(in: payload(#"{"requestId":"   "}"#)), "unknown")
    XCTAssertEqual(NativeHostRequestDecoding.requestID(in: payload("not json")), "unknown")
    XCTAssertEqual(NativeHostRequestDecoding.requestID(in: payload("[1,2,3]")), "unknown")
    // The encoder clamps an over-long id to something reply-safe.
    let huge = String(repeating: "a", count: 500)
    XCTAssertEqual(
      NativeHostRequestDecoding.requestID(in: payload(#"{"requestId":"\#(huge)"}"#)), "unknown")
    let reply = try? NativeHostRequestDecoding.errorReply(
      for: payload("not json"), error: .invalidJSON)
    XCTAssertNotNil(reply, "even an unparseable payload must yield a reply")
  }

  func testEveryProtocolErrorExplainsItself() {
    for error: NativeHostProtocolError in [
      .invalidJSON, .invalidProtocolVersion, .invalidRequestID, .invalidRequestType,
      .invalidRequestFields, .invalidResponse,
    ] {
      XCTAssertFalse(NativeHostRequestDecoding.message(for: error).isEmpty)
    }
  }
}

final class NativeHostErrorEncodingTests: XCTestCase {
  func testEveryCodeTheHostCanEmitIsOnTheWireContract() {
    // The literal codes the Swift host passes to the encoder. Keep in sync with
    // `grep -rho 'code: "[a-z_]*"' Sources/`.
    let emitted = [
      "accessibility_permission_denied", "action_noop", "action_not_allowed",
      "environment_unavailable", "focus_mismatch", "handoff_required",
      "invalid_request",
      "native_host_incompatible", "screen_locked", "screen_permission_denied",
      "sensitive_input_blocked", "session_canceled", "stale_frame", "stale_tree",
    ]
    for code in emitted {
      XCTAssertTrue(
        allowedErrorCodes.contains(code),
        "\(code) is emitted by the host but missing from allowedErrorCodes — the host would exit instead of reporting it")
    }
  }

  func testLockedScreenIsReportableAsItsOwnCode() throws {
    let data = try NativeHostResponseEncoder.error(
      requestID: "request-lock",
      code: "screen_locked",
      message: "The display is locked.",
      retryable: true
    )
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let body = try XCTUnwrap(object["error"] as? [String: Any])
    XCTAssertEqual(body["code"] as? String, "screen_locked")
    XCTAssertEqual(body["retryable"] as? Bool, true)
  }

  func testUnknownCodeDegradesInsteadOfThrowing() throws {
    let data = try NativeHostResponseEncoder.error(
      requestID: "request-unknown",
      code: "some_future_code",
      message: "Something new failed",
      retryable: false
    )
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let body = try XCTUnwrap(object["error"] as? [String: Any])
    XCTAssertEqual(body["code"] as? String, NativeHostResponseEncoder.fallbackErrorCode)
    // The original code stays visible to the client and in the logs.
    XCTAssertEqual(body["message"] as? String, "[some_future_code] Something new failed")
  }

  func testOversizedMessageIsClampedNotFatal() throws {
    let data = try NativeHostResponseEncoder.error(
      requestID: "request-long",
      code: "action_noop",
      message: String(repeating: "x", count: 10_000),
      retryable: false
    )
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    let body = try XCTUnwrap(object["error"] as? [String: Any])
    let message = try XCTUnwrap(body["message"] as? String)
    XCTAssertEqual(message.count, NativeHostResponseEncoder.maxErrorMessageCharacters)
    XCTAssertEqual(body["code"] as? String, "action_noop")
  }

  func testEmptyMessageAndInvalidRequestIDAreRepaired() throws {
    let data = try NativeHostResponseEncoder.error(
      // 201 characters: over the 200-character identifier bound.
      requestID: String(repeating: "r", count: 201),
      code: "action_noop",
      message: "   ",
      retryable: false
    )
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    XCTAssertEqual(object["requestId"] as? String, "unknown")
    let body = try XCTUnwrap(object["error"] as? [String: Any])
    XCTAssertFalse((body["message"] as? String ?? "").isEmpty)
  }
}
