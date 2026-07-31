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
