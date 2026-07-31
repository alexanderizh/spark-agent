import Foundation

public struct NativeCapturedWindow: Equatable, Sendable {
  public let bytes: Data
  public let width: Int
  public let height: Int

  public init(bytes: Data, width: Int, height: Int) {
    self.bytes = bytes
    self.width = width
    self.height = height
  }
}

public enum NativeHostPlatformError: Error, Equatable, Sendable {
  case screenPermissionDenied
  case windowNotFound
  case invalidWindowGeometry
  case captureFailed
  case resourceLimitExceeded
  case accessibilityPermissionDenied
  case environmentUnavailable
  case focusMismatch
  case staleFrame
  case staleTree
  case sensitiveInputBlocked
  case actionNotAllowed
  case actionNoop
  case sessionCanceled
  case userTakeover
}

public enum NativeActionStatus: String, Equatable, Sendable {
  case executed
  case noop
}

public struct NativeObservedWindow: Equatable, Sendable {
  public let frameID: String
  public let treeVersion: String
  public let capturedAt: String
  public let display: NativeDisplayGeometry
  public let app: NativeAppIdentity
  public let window: NativeWindowIdentity
  public let snapshotID: String
  public let capture: NativeCapturedWindow
  public let treeMode: NativeAXTreeMode
  public let treeText: String
  public let elements: [NativeAXElementRef]
  public let loading: Bool
  public let sensitiveRegions: [NativeRect]

  public init(
    frameID: String, treeVersion: String, capturedAt: String, display: NativeDisplayGeometry,
    app: NativeAppIdentity, window: NativeWindowIdentity, snapshotID: String,
    capture: NativeCapturedWindow, treeMode: NativeAXTreeMode, treeText: String,
    elements: [NativeAXElementRef], loading: Bool, sensitiveRegions: [NativeRect]
  ) {
    self.frameID = frameID
    self.treeVersion = treeVersion
    self.capturedAt = capturedAt
    self.display = display
    self.app = app
    self.window = window
    self.snapshotID = snapshotID
    self.capture = capture
    self.treeMode = treeMode
    self.treeText = treeText
    self.elements = elements
    self.loading = loading
    self.sensitiveRegions = sensitiveRegions
  }
}

public protocol NativeHostPlatformProviding: Sendable {
  func capabilityManifest() async -> NativeCapabilityManifest
  func requestPermissions(
    _ permissions: [NativeHostPermissionRequest]
  ) async -> NativeCapabilityManifest
  func listWindows() async throws -> [NativeWindowDescriptor]
  func captureWindow(id: String) async throws -> NativeCapturedWindow
  func observe(
    snapshotID: String, appID: String, windowID: String,
    previousTreeVersion: String?, fullTree: Bool, persistentCapture: Bool
  ) async throws -> NativeObservedWindow
  func executeAction(_ envelope: NativeComputerActionEnvelope) async throws -> NativeActionStatus
  func cancelSession(id: String) async
}

extension NativeHostPlatformProviding {
  public func requestPermissions(
    _ permissions: [NativeHostPermissionRequest]
  ) async -> NativeCapabilityManifest {
    await capabilityManifest()
  }

  public func observe(
    snapshotID: String, appID: String, windowID: String,
    previousTreeVersion: String?, fullTree: Bool, persistentCapture: Bool
  ) async throws -> NativeObservedWindow {
    throw NativeHostPlatformError.environmentUnavailable
  }

  public func executeAction(
    _ envelope: NativeComputerActionEnvelope
  ) async throws -> NativeActionStatus {
    throw NativeHostPlatformError.environmentUnavailable
  }
}

public struct NativeHostReply: Equatable, Sendable {
  public let json: Data
  public let binary: Data?

  public init(json: Data, binary: Data? = nil) {
    self.json = json
    self.binary = binary
  }
}

public actor NativeHostRequestHandler {
  private let provider: any NativeHostPlatformProviding
  private var canceledSessions: Set<String> = []

  public init(provider: any NativeHostPlatformProviding) {
    self.provider = provider
  }

  public func handle(_ request: NativeHostRequest) async throws -> NativeHostReply {
    do {
      switch request {
      case .getCapabilities(let requestID):
        return NativeHostReply(
          json: try NativeHostResponseEncoder.capabilities(
            requestID: requestID,
            manifest: await provider.capabilityManifest()
          )
        )
      case .requestPermissions(let requestID, let permissions):
        return NativeHostReply(
          json: try NativeHostResponseEncoder.capabilities(
            requestID: requestID,
            manifest: await provider.requestPermissions(permissions)
          )
        )
      case .listWindows(let requestID):
        return NativeHostReply(
          json: try NativeHostResponseEncoder.windows(
            requestID: requestID,
            windows: try await provider.listWindows()
          )
        )
      case .captureWindow(let requestID, let snapshotID, let windowID):
        let capture = try await provider.captureWindow(id: windowID)
        guard capture.width > 0, capture.height > 0,
          capture.width <= 16_384, capture.height <= 16_384,
          !capture.bytes.isEmpty,
          capture.bytes.count <= maxNativeHostFramePayloadBytes
        else {
          throw NativeHostPlatformError.resourceLimitExceeded
        }
        return NativeHostReply(
          json: try NativeHostResponseEncoder.captureResult(
            requestID: requestID,
            snapshotID: snapshotID,
            width: capture.width,
            height: capture.height,
            payload: .png(capture.bytes)
          ),
          binary: capture.bytes
        )
      case .cancelSession(let requestID, let computerSessionID):
        canceledSessions.insert(computerSessionID)
        await provider.cancelSession(id: computerSessionID)
        return NativeHostReply(json: try NativeHostResponseEncoder.ack(requestID: requestID))
      case .ping(let requestID):
        return NativeHostReply(json: try NativeHostResponseEncoder.pong(requestID: requestID))
      case .observe(
        let requestID, let snapshotID, let appID, let windowID,
        let previousTreeVersion, let fullTree, let persistentCapture
      ):
        let observed = try await provider.observe(
          snapshotID: snapshotID, appID: appID, windowID: windowID,
          previousTreeVersion: previousTreeVersion, fullTree: fullTree,
          persistentCapture: persistentCapture
        )
        guard observed.snapshotID == snapshotID, observed.app.id == appID,
          observed.window.id == windowID
        else { throw NativeHostPlatformError.focusMismatch }
        try validateObservation(observed)
        return NativeHostReply(
          json: try NativeHostResponseEncoder.observation(requestID: requestID, observed: observed),
          binary: observed.capture.bytes
        )
      case .executeAction(let requestID, let envelope):
        guard !canceledSessions.contains(envelope.computerSessionID) else {
          return NativeHostReply(
            json: try NativeHostResponseEncoder.error(
              requestID: requestID, code: "session_canceled",
              message: "The computer session was canceled", retryable: false
            )
          )
        }
        return NativeHostReply(
          json: try NativeHostResponseEncoder.actionResult(
            requestID: requestID, actionID: envelope.actionID,
            status: try await provider.executeAction(envelope)
          )
        )
      }
    } catch let error as NativeHostPlatformError {
      return NativeHostReply(json: try encodePlatformError(error, requestID: request.requestID))
    } catch let error as NativeControlPolicyError {
      return NativeHostReply(
        json: try encodeControlPolicyError(error, requestID: request.requestID))
    }
  }

  private func encodePlatformError(
    _ error: NativeHostPlatformError,
    requestID: String
  ) throws -> Data {
    switch error {
    case .screenPermissionDenied:
      return try NativeHostResponseEncoder.error(
        requestID: requestID,
        code: "screen_permission_denied",
        message: "Screen Recording permission is required",
        retryable: true
      )
    case .windowNotFound:
      return try NativeHostResponseEncoder.error(
        requestID: requestID,
        code: "focus_mismatch",
        message: "The requested window is no longer available",
        retryable: true
      )
    case .invalidWindowGeometry, .captureFailed, .resourceLimitExceeded:
      return try NativeHostResponseEncoder.error(
        requestID: requestID,
        code: "native_host_incompatible",
        message: "The Native Host could not produce a valid capture",
        retryable: false
      )
    case .accessibilityPermissionDenied:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "accessibility_permission_denied",
        message: "Accessibility permission is required", retryable: true)
    case .environmentUnavailable:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "environment_unavailable",
        message: "Native macOS control APIs are unavailable", retryable: false)
    case .focusMismatch:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "focus_mismatch",
        message: "The foreground application identity changed", retryable: true)
    case .staleFrame:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "stale_frame",
        message: "A fresh observation is required", retryable: true)
    case .staleTree:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "stale_tree",
        message: "The accessibility element reference is stale", retryable: true)
    case .sensitiveInputBlocked:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "sensitive_input_blocked",
        message: "Input to a protected target is forbidden", retryable: false)
    case .actionNotAllowed:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "action_not_allowed",
        message: "The requested action is not supported", retryable: false)
    case .actionNoop:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "action_noop",
        message: "macOS did not confirm the requested action", retryable: true)
    case .sessionCanceled:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "session_canceled",
        message: "The computer session was canceled", retryable: false)
    case .userTakeover:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "handoff_required",
        message: "The user took control of the target window", retryable: false)
    }
  }

  private func validateObservation(_ value: NativeObservedWindow) throws {
    let capture = value.capture
    let app = value.app
    let window = value.window
    let display = value.display
    let validElementActions: Set<String> = [
      "invoke", "set_value", "select", "scroll", "focus", "expand", "collapse",
    ]
    guard capture.width > 0, capture.height > 0,
      capture.width <= 16_384, capture.height <= 16_384,
      !capture.bytes.isEmpty, capture.bytes.count <= maxNativeHostFramePayloadBytes,
      validWireIdentifier(value.frameID), validWireIdentifier(value.treeVersion),
      validWireIdentifier(value.snapshotID), validISO8601(value.capturedAt),
      validWireIdentifier(display.id), display.width > 0, display.width <= 131_072,
      display.height > 0, display.height <= 131_072,
      display.scaleFactor.isFinite, display.scaleFactor > 0, display.scaleFactor <= 8,
      validWireIdentifier(app.id), validMetadata(app.name, min: 1, max: 300, trimmed: true),
      app.processId.map({ $0 > 0 }) ?? true,
      validOptionalIdentifier(app.bundleId), validOptionalIdentifier(app.executableIdentity),
      validOptionalIdentifier(app.signingIdentity),
      validWireIdentifier(window.id), validMetadata(window.title, min: 0, max: 2_000),
      validWireRect(window.bounds),
      value.elements.count <= maxNativeTreeElements, value.treeText.utf16.count <= 2_000_000,
      value.sensitiveRegions.count <= 10_000,
      value.sensitiveRegions.allSatisfy(validWireRect),
      value.elements.allSatisfy({ element in
        validWireIdentifier(element.id) && element.treeVersion == value.treeVersion
          && validMetadata(element.role, min: 1, max: 120, trimmed: true)
          && validMetadata(element.name, min: 0, max: 2_000)
          && element.value.map({ $0.utf16.count <= maxNativeTextUTF16Units }) ?? true
          && validWireRect(element.bounds) && element.actions.count <= 20
          && element.actions.allSatisfy(validElementActions.contains)
      })
    else { throw NativeHostPlatformError.resourceLimitExceeded }
  }

  private func encodeControlPolicyError(
    _ error: NativeControlPolicyError,
    requestID: String
  ) throws -> Data {
    switch error {
    case .staleTree, .elementNotFound:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "stale_tree",
        message: "The accessibility element reference is stale", retryable: true)
    case .sensitiveElement:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "sensitive_input_blocked",
        message: "Input to a protected element is forbidden", retryable: false)
    case .focusMismatch:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "focus_mismatch",
        message: "The foreground application identity changed", retryable: true)
    case .invalidCoordinate, .resourceLimitExceeded:
      return try NativeHostResponseEncoder.error(
        requestID: requestID, code: "action_not_allowed",
        message: "The requested action exceeds Native Host safety limits", retryable: false)
    }
  }
}

private func validWireIdentifier(_ value: String) -> Bool {
  value == value.trimmingCharacters(in: .whitespacesAndNewlines)
    && !value.isEmpty && value.utf16.count <= 200
    && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
}

private func validOptionalIdentifier(_ value: String?) -> Bool {
  value.map(validWireIdentifier) ?? true
}

private func validMetadata(
  _ value: String,
  min: Int,
  max: Int,
  trimmed: Bool = false
) -> Bool {
  let checked = trimmed ? value.trimmingCharacters(in: .whitespacesAndNewlines) : value
  return checked.utf16.count >= min && checked.utf16.count <= max
}

private func validWireRect(_ value: NativeRect) -> Bool {
  value.x.isFinite && value.y.isFinite && value.width.isFinite && value.height.isFinite
    && (-131_072...131_072).contains(value.x) && (-131_072...131_072).contains(value.y)
    && value.width > 0 && value.width <= 131_072
    && value.height > 0 && value.height <= 131_072
}

private func validISO8601(_ value: String) -> Bool {
  ISO8601DateFormatter().date(from: value) != nil
}
