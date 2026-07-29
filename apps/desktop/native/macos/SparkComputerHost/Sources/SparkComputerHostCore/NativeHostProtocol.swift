import CryptoKit
import Foundation

public let nativeHostProtocolVersion = 1

public enum NativeHostPermissionRequest: String, Equatable, Sendable {
  case screen
  case accessibility
}

public enum NativeHostRequest: Equatable, Sendable {
  case getCapabilities(requestID: String)
  case requestPermissions(requestID: String, permissions: [NativeHostPermissionRequest])
  case listWindows(requestID: String)
  case captureWindow(requestID: String, snapshotID: String, windowID: String)
  case observe(
    requestID: String,
    snapshotID: String,
    appID: String,
    windowID: String,
    previousTreeVersion: String?,
    fullTree: Bool
  )
  case executeAction(requestID: String, envelope: NativeComputerActionEnvelope)
  case cancelSession(requestID: String, computerSessionID: String)
  case ping(requestID: String)

  public var requestID: String {
    switch self {
    case .getCapabilities(let requestID),
      .requestPermissions(let requestID, _),
      .listWindows(let requestID),
      .captureWindow(let requestID, _, _),
      .observe(let requestID, _, _, _, _, _),
      .executeAction(let requestID, _),
      .cancelSession(let requestID, _),
      .ping(let requestID):
      return requestID
    }
  }
}

public enum NativeHostProtocolError: Error, Equatable, Sendable {
  case invalidJSON
  case invalidProtocolVersion
  case invalidRequestID
  case invalidRequestType
  case invalidRequestFields
  case invalidResponse
}

public struct NativeHostRequestDecoder: Sendable {
  public init() {}

  public func decode(_ data: Data) throws -> NativeHostRequest {
    guard data.count <= maxNativeHostFramePayloadBytes else {
      throw NativeHostProtocolError.invalidJSON
    }
    let value: Any
    do {
      value = try JSONSerialization.jsonObject(with: data, options: [])
    } catch {
      throw NativeHostProtocolError.invalidJSON
    }
    guard let object = value as? [String: Any] else {
      throw NativeHostProtocolError.invalidJSON
    }
    guard strictInteger(object["protocolVersion"]) == nativeHostProtocolVersion else {
      throw NativeHostProtocolError.invalidProtocolVersion
    }
    guard let requestID = object["requestId"] as? String, isValidIdentifier(requestID) else {
      throw NativeHostProtocolError.invalidRequestID
    }
    guard let type = object["type"] as? String else {
      throw NativeHostProtocolError.invalidRequestType
    }

    switch type {
    case "get_capabilities":
      try requireKeys(object, exactly: ["protocolVersion", "requestId", "type"])
      return .getCapabilities(requestID: requestID)
    case "request_permissions":
      try requireKeys(
        object,
        exactly: ["protocolVersion", "requestId", "type", "permissions"]
      )
      guard let rawPermissions = object["permissions"] as? [String],
        (1...2).contains(rawPermissions.count),
        Set(rawPermissions).count == rawPermissions.count
      else {
        throw NativeHostProtocolError.invalidRequestFields
      }
      let permissions = try rawPermissions.map { value in
        guard let permission = NativeHostPermissionRequest(rawValue: value) else {
          throw NativeHostProtocolError.invalidRequestFields
        }
        return permission
      }
      return .requestPermissions(requestID: requestID, permissions: permissions)
    case "list_windows":
      try requireKeys(object, exactly: ["protocolVersion", "requestId", "type"])
      return .listWindows(requestID: requestID)
    case "capture_window":
      try requireKeys(
        object,
        exactly: ["protocolVersion", "requestId", "type", "snapshotId", "windowId"]
      )
      return .captureWindow(
        requestID: requestID,
        snapshotID: try requireIdentifier(object["snapshotId"]),
        windowID: try requireIdentifier(object["windowId"])
      )
    case "observe":
      try requireKeys(
        object,
        exactly: [
          "protocolVersion", "requestId", "type", "snapshotId", "appId", "windowId",
          "previousTreeVersion", "fullTree",
        ]
      )
      let previousTreeVersion: String?
      if object["previousTreeVersion"] is NSNull {
        previousTreeVersion = nil
      } else {
        previousTreeVersion = try requireIdentifier(object["previousTreeVersion"])
      }
      guard let fullTree = strictBoolean(object["fullTree"]) else {
        throw NativeHostProtocolError.invalidRequestFields
      }
      return .observe(
        requestID: requestID,
        snapshotID: try requireIdentifier(object["snapshotId"]),
        appID: try requireIdentifier(object["appId"]),
        windowID: try requireIdentifier(object["windowId"]),
        previousTreeVersion: previousTreeVersion,
        fullTree: fullTree
      )
    case "execute_action":
      try requireKeys(
        object,
        exactly: ["protocolVersion", "requestId", "type", "envelope"]
      )
      return .executeAction(
        requestID: requestID,
        envelope: try decodeComputerActionEnvelope(object["envelope"])
      )
    case "cancel_session":
      try requireKeys(
        object,
        exactly: ["protocolVersion", "requestId", "type", "computerSessionId"]
      )
      return .cancelSession(
        requestID: requestID,
        computerSessionID: try requireIdentifier(object["computerSessionId"])
      )
    case "ping":
      try requireKeys(object, exactly: ["protocolVersion", "requestId", "type"])
      return .ping(requestID: requestID)
    default:
      throw NativeHostProtocolError.invalidRequestType
    }
  }
}

public struct NativeCapabilityManifest: Codable, Equatable, Sendable {
  public struct Backends: Codable, Equatable, Sendable {
    public let screen: String
    public let accessibility: String
    public let input: String
  }

  public struct Features: Codable, Equatable, Sendable {
    public let listWindows: Bool
    public let captureWindow: Bool
    public let fullTree: Bool
    public let diffTree: Bool
    public let semanticActions: Bool
    public let absolutePointer: Bool
    public let keyboard: Bool
    public let clipboard: Bool
  }

  public struct Permissions: Codable, Equatable, Sendable {
    public let screen: String
    public let accessibility: String
    public let input: String
  }

  public struct Limits: Codable, Equatable, Sendable {
    public let maxMessageBytes: Int
    public let maxScreenshotWidth: Int
    public let maxScreenshotHeight: Int
    public let maxTreeElements: Int
  }

  public let protocolVersion: Int
  public let hostVersion: String
  public let platform: String
  public let architecture: String
  public let backends: Backends
  public let features: Features
  public let permissions: Permissions
  public let limits: Limits

  public static func macosScreenCapture(
    hostVersion: String,
    architecture: String,
    screenPermission: String,
    accessibilityPermission: String = "not_determined",
    inputPermission: String? = nil,
    captureWindowSupported: Bool = true,
    accessibilityAvailable: Bool = false,
    inputAvailable: Bool = false
  ) -> NativeCapabilityManifest {
    NativeCapabilityManifest(
      protocolVersion: nativeHostProtocolVersion,
      hostVersion: hostVersion,
      platform: "macos",
      architecture: architecture,
      backends: Backends(
        screen: "screen_capture_kit",
        accessibility: accessibilityAvailable ? "axui_element" : "unavailable",
        input: inputAvailable ? "cg_event" : "unavailable"
      ),
      features: Features(
        listWindows: true,
        captureWindow: captureWindowSupported,
        fullTree: accessibilityAvailable,
        diffTree: accessibilityAvailable,
        semanticActions: accessibilityAvailable,
        absolutePointer: inputAvailable,
        keyboard: inputAvailable,
        clipboard: false
      ),
      permissions: Permissions(
        screen: screenPermission,
        accessibility: accessibilityPermission,
        input: inputPermission ?? accessibilityPermission
      ),
      limits: Limits(
        maxMessageBytes: maxNativeHostFramePayloadBytes,
        maxScreenshotWidth: 16_384,
        maxScreenshotHeight: 16_384,
        maxTreeElements: maxNativeTreeElements
      )
    )
  }
}

public struct NativeRect: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double
  public let width: Double
  public let height: Double

  public init(x: Double, y: Double, width: Double, height: Double) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

public struct NativeAppIdentity: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let processId: Int32?
  public let bundleId: String?
  public let executableIdentity: String?
  public let signingIdentity: String?

  public init(
    id: String,
    name: String,
    processId: Int32?,
    bundleId: String?,
    executableIdentity: String?,
    signingIdentity: String?
  ) {
    self.id = id
    self.name = name
    self.processId = processId
    self.bundleId = bundleId
    self.executableIdentity = executableIdentity
    self.signingIdentity = signingIdentity
  }
}

public struct NativeWindowIdentity: Codable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let bounds: NativeRect

  public init(id: String, title: String, bounds: NativeRect) {
    self.id = id
    self.title = title
    self.bounds = bounds
  }
}

public struct NativeDisplayGeometry: Codable, Equatable, Sendable {
  public let id: String
  public let width: Int
  public let height: Int
  public let scaleFactor: Double

  public init(id: String, width: Int, height: Int, scaleFactor: Double) {
    self.id = id
    self.width = width
    self.height = height
    self.scaleFactor = scaleFactor
  }
}

public struct NativeWindowDescriptor: Codable, Equatable, Sendable {
  public let app: NativeAppIdentity
  public let window: NativeWindowIdentity
  public let display: NativeDisplayGeometry
  public let focused: Bool
  public let minimized: Bool

  public init(
    app: NativeAppIdentity,
    window: NativeWindowIdentity,
    display: NativeDisplayGeometry,
    focused: Bool,
    minimized: Bool
  ) {
    self.app = app
    self.window = window
    self.display = display
    self.focused = focused
    self.minimized = minimized
  }
}

public struct NativeBinaryPayloadDescriptor: Codable, Equatable, Sendable {
  public let kind: String
  public let byteLength: Int
  public let sha256: String

  public static func png(_ bytes: Data) -> NativeBinaryPayloadDescriptor {
    NativeBinaryPayloadDescriptor(
      kind: "image_png",
      byteLength: bytes.count,
      sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    )
  }
}

public enum NativeHostResponseEncoder {
  public static func capabilities(
    requestID: String,
    manifest: NativeCapabilityManifest
  ) throws -> Data {
    try encode(
      CapabilitiesResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "capabilities",
        manifest: manifest
      )
    )
  }

  public static func windows(
    requestID: String,
    windows: [NativeWindowDescriptor]
  ) throws -> Data {
    try encode(
      WindowsResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "windows",
        windows: windows
      )
    )
  }

  public static func captureResult(
    requestID: String,
    snapshotID: String,
    width: Int,
    height: Int,
    payload: NativeBinaryPayloadDescriptor
  ) throws -> Data {
    try encode(
      CaptureResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "capture_result",
        snapshotId: snapshotID,
        width: width,
        height: height,
        payload: payload
      )
    )
  }

  public static func observation(
    requestID: String,
    observed: NativeObservedWindow
  ) throws -> Data {
    try encode(
      ObservationResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "observation",
        observation: ObservationBody(observed),
        payload: .png(observed.capture.bytes)
      )
    )
  }

  public static func actionResult(
    requestID: String,
    actionID: String,
    status: NativeActionStatus
  ) throws -> Data {
    try encode(
      ActionResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "action_result",
        actionId: actionID,
        status: status.rawValue
      )
    )
  }

  public static func ack(requestID: String) throws -> Data {
    try simple(requestID: requestID, type: "ack")
  }

  public static func pong(requestID: String) throws -> Data {
    try simple(requestID: requestID, type: "pong")
  }

  public static func error(
    requestID: String,
    code: String,
    message: String,
    retryable: Bool
  ) throws -> Data {
    guard isValidIdentifier(requestID), allowedErrorCodes.contains(code),
      !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      message.count <= 4_000
    else {
      throw NativeHostProtocolError.invalidResponse
    }
    return try encode(
      ErrorResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: "error",
        error: ErrorBody(code: code, message: message, retryable: retryable)
      )
    )
  }

  private static func simple(requestID: String, type: String) throws -> Data {
    try encode(
      SimpleResponse(
        protocolVersion: nativeHostProtocolVersion,
        requestId: requestID,
        type: type
      )
    )
  }

  private static func encode<Value: Encodable>(_ value: Value) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try encoder.encode(value)
  }
}

private struct CapabilitiesResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let manifest: NativeCapabilityManifest
}

private struct WindowsResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let windows: [NativeWindowDescriptor]
}

private struct CaptureResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let snapshotId: String
  let width: Int
  let height: Int
  let payload: NativeBinaryPayloadDescriptor
}

private struct ObservationResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let observation: ObservationBody
  let payload: NativeBinaryPayloadDescriptor
}

private struct ObservationBody: Encodable {
  struct Foreground: Encodable {
    let app: NativeAppIdentity
    let window: NativeWindowIdentity
  }

  struct Screenshot: Encodable {
    let snapshotId: String
    let width: Int
    let height: Int
  }

  struct Tree: Encodable {
    let mode: String
    let text: String
    let elementCount: Int
  }

  let frameId: String
  let treeVersion: String
  let capturedAt: String
  let display: NativeDisplayGeometry
  let foreground: Foreground
  let screenshot: Screenshot
  let tree: Tree
  let elements: [NativeAXElementRef]
  let loading: Bool
  let sensitiveRegions: [NativeRect]

  init(_ value: NativeObservedWindow) {
    frameId = value.frameID
    treeVersion = value.treeVersion
    capturedAt = value.capturedAt
    display = value.display
    foreground = Foreground(app: value.app, window: value.window)
    screenshot = Screenshot(
      snapshotId: value.snapshotID, width: value.capture.width, height: value.capture.height)
    tree = Tree(
      mode: value.treeMode.rawValue, text: value.treeText, elementCount: value.elements.count)
    elements = value.elements
    loading = value.loading
    sensitiveRegions = value.sensitiveRegions
  }
}

private struct ActionResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let actionId: String
  let status: String
}

private struct SimpleResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
}

private struct ErrorBody: Encodable {
  let code: String
  let message: String
  let retryable: Bool
}

private struct ErrorResponse: Encodable {
  let protocolVersion: Int
  let requestId: String
  let type: String
  let error: ErrorBody
}

private func requireKeys(_ object: [String: Any], exactly keys: Set<String>) throws {
  guard Set(object.keys) == keys else { throw NativeHostProtocolError.invalidRequestFields }
}

private func requireIdentifier(_ value: Any?) throws -> String {
  guard let value = value as? String, isValidIdentifier(value) else {
    throw NativeHostProtocolError.invalidRequestFields
  }
  return value
}

private func isValidIdentifier(_ value: String) -> Bool {
  guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
    value.count <= 200
  else { return false }
  return !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
}

private func strictInteger(_ value: Any?) -> Int? {
  guard let number = value as? NSNumber,
    CFGetTypeID(number) != CFBooleanGetTypeID()
  else { return nil }
  let integer = number.intValue
  return number.doubleValue == Double(integer) ? integer : nil
}

private func strictBoolean(_ value: Any?) -> Bool? {
  guard let number = value as? NSNumber,
    CFGetTypeID(number) == CFBooleanGetTypeID()
  else { return nil }
  return number.boolValue
}

private let allowedErrorCodes: Set<String> = [
  "computer_disabled", "environment_unavailable", "native_host_missing",
  "native_host_incompatible", "native_host_untrusted", "screen_permission_denied",
  "accessibility_permission_denied", "app_not_allowed", "domain_not_allowed",
  "action_not_allowed", "actuator_lease_conflict", "stale_frame", "stale_tree",
  "focus_mismatch", "display_topology_changed", "privilege_mismatch", "action_noop",
  "action_timeout", "sensitive_input_blocked", "approval_required", "approval_expired",
  "approval_mismatch", "prompt_injection_suspected", "verification_failed",
  "verification_inconclusive", "handoff_required", "session_paused", "session_canceled",
]
