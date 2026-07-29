import CryptoKit
import Foundation

public let maxNativeTreeElements = 2_000

public enum NativeControlPolicyError: Error, Equatable, Sendable {
  case staleTree
  case elementNotFound
  case sensitiveElement
  case focusMismatch
  case invalidCoordinate
  case resourceLimitExceeded
}

public struct NativeScreenPoint: Equatable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct NativeTargetIdentity: Equatable, Sendable {
  public let appID: String
  public let windowID: String
  public var processID: Int32
  public let bundleID: String?
  public let executableIdentity: String?
  public let signingIdentity: String?
  public let focused: Bool
  public let windowBounds: NativeRect

  public init(
    appID: String, windowID: String, processID: Int32, bundleID: String?,
    executableIdentity: String?, signingIdentity: String?, focused: Bool,
    windowBounds: NativeRect
  ) {
    self.appID = appID
    self.windowID = windowID
    self.processID = processID
    self.bundleID = bundleID
    self.executableIdentity = executableIdentity
    self.signingIdentity = signingIdentity
    self.focused = focused
    self.windowBounds = windowBounds
  }
}

public enum NativeInputPolicy {
  public static func validateApplicationIdentity(
    expected: NativeTargetIdentity, current: NativeTargetIdentity
  ) throws {
    guard expected.appID == current.appID,
      expected.processID == current.processID,
      expected.bundleID == current.bundleID,
      expected.executableIdentity == current.executableIdentity,
      expected.signingIdentity == current.signingIdentity
    else { throw NativeControlPolicyError.focusMismatch }
  }

  public static func screenPoint(
    normalizedX: Double, normalizedY: Double, windowBounds: NativeRect
  ) throws -> NativeScreenPoint {
    guard normalizedX.isFinite, normalizedY.isFinite,
      (0...1).contains(normalizedX), (0...1).contains(normalizedY),
      windowBounds.x.isFinite, windowBounds.y.isFinite,
      windowBounds.width.isFinite, windowBounds.height.isFinite,
      windowBounds.width > 0, windowBounds.height > 0
    else { throw NativeControlPolicyError.invalidCoordinate }
    let x = windowBounds.x + windowBounds.width * normalizedX
    let y = windowBounds.y + windowBounds.height * normalizedY
    guard x.isFinite, y.isFinite, abs(x) <= 1_000_000, abs(y) <= 1_000_000 else {
      throw NativeControlPolicyError.invalidCoordinate
    }
    return NativeScreenPoint(x: x, y: y)
  }

  public static func validateText(_ text: String, allowEmpty: Bool = false) throws {
    guard allowEmpty || !text.isEmpty, text.utf16.count <= maxNativeTextUTF16Units else {
      throw NativeControlPolicyError.resourceLimitExceeded
    }
  }

  public static func validateKeys(_ keys: [String]) throws {
    guard (1...maxNativeKeyChordKeys).contains(keys.count) else {
      throw NativeControlPolicyError.resourceLimitExceeded
    }
  }

  public static func keypressCanModifySecureField(_ keys: [String]) -> Bool {
    let modifiers = Set(["Meta", "Control", "Alt", "Shift"])
    return keys.contains { key in
      !modifiers.contains(key)
        && ![
          "Escape", "Tab", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "F1", "F2",
          "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13",
          "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23",
          "F24",
        ].contains(key)
    }
  }

  public static func isSensitiveTarget(appName: String, bundleID: String?) -> Bool {
    let value = "\(appName) \(bundleID ?? "")".lowercased()
    let blocked = [
      "securityagent", "loginwindow", "passwords", "keychainaccess", "1password", "bitwarden",
      "keepass", "keepassxc", "com.apple.securityagent", "com.apple.loginwindow",
      "com.apple.passwords",
    ]
    return blocked.contains { value.contains($0) }
  }

}

public struct NativeAXRawElement: Equatable, Sendable {
  public let runtimeID: String
  public let role: String
  public let name: String
  public let value: String?
  public let bounds: NativeRect
  public let enabled: Bool
  public let focused: Bool
  public let actions: [String]
  public let secure: Bool

  public init(
    runtimeID: String, role: String, name: String, value: String?, bounds: NativeRect,
    enabled: Bool, focused: Bool, actions: [String], secure: Bool
  ) {
    self.runtimeID = runtimeID
    self.role = role
    self.name = name
    self.value = value
    self.bounds = bounds
    self.enabled = enabled
    self.focused = focused
    self.actions = actions
    self.secure = secure
  }
}

public struct NativeAXElementRef: Codable, Equatable, Sendable {
  public let id: String
  public let treeVersion: String
  public let role: String
  public let name: String
  public let value: String?
  public let bounds: NativeRect
  public let enabled: Bool
  public let focused: Bool
  public let actions: [String]
}

public enum NativeAXTreeMode: String, Codable, Equatable, Sendable {
  case full
  case diff
}

public struct NativeAXTreeSnapshot: Equatable, Sendable {
  public let treeVersion: String
  public let mode: NativeAXTreeMode
  public let text: String
  public let elements: [NativeAXElementRef]
  public let sensitiveRegions: [NativeRect]

  public init(
    treeVersion: String,
    mode: NativeAXTreeMode,
    text: String,
    elements: [NativeAXElementRef],
    sensitiveRegions: [NativeRect]
  ) {
    self.treeVersion = treeVersion
    self.mode = mode
    self.text = text
    self.elements = elements
    self.sensitiveRegions = sensitiveRegions
  }
}

public struct NativeAXTreeState: Sendable {
  private var generation = 0
  private var currentVersion: String?
  private var elementsByID: [String: NativeAXElementRef] = [:]
  private var runtimeByID: [String: String] = [:]
  private var secureIDs: Set<String> = []

  public init() {}

  public mutating func publish(
    elements rawElements: [NativeAXRawElement], previousTreeVersion: String?, fullTree: Bool
  ) -> NativeAXTreeSnapshot {
    generation &+= 1
    let bounded = rawElements.prefix(maxNativeTreeElements).map(sanitize)
    let fingerprint = bounded.map {
      "\($0.runtimeID)|\($0.role)|\($0.name)|\($0.value ?? "")|\($0.bounds)|\($0.enabled)|\($0.focused)|\($0.actions)"
    }.joined(separator: "\n")
    let digest = SHA256.hash(data: Data("\(generation)|\(fingerprint)".utf8))
    let version = "tree-" + digest.prefix(16).map { String(format: "%02x", $0) }.joined()
    let published = bounded.enumerated().map { index, element -> NativeAXElementRef in
      let idDigest = SHA256.hash(data: Data("\(element.runtimeID)|\(index)".utf8))
      let id = "element-" + idDigest.prefix(16).map { String(format: "%02x", $0) }.joined()
      return NativeAXElementRef(
        id: id, treeVersion: version, role: element.role, name: element.name,
        value: element.secure ? nil : element.value, bounds: element.bounds,
        enabled: element.enabled, focused: element.focused,
        actions: Array(element.actions.prefix(20))
      )
    }
    let canDiff = !fullTree && previousTreeVersion != nil && previousTreeVersion == currentVersion
    let mode: NativeAXTreeMode = canDiff ? .diff : .full
    let previous = elementsByID
    let current = Dictionary(uniqueKeysWithValues: published.map { ($0.id, $0) })
    let text: String
    if canDiff {
      let changed = published.filter { element in
        guard let old = previous[element.id] else { return true }
        return old.role != element.role || old.name != element.name || old.value != element.value
          || old.bounds != element.bounds || old.enabled != element.enabled
          || old.focused != element.focused || old.actions != element.actions
      }
      let removed = previous.keys.filter { current[$0] == nil }.sorted()
      text = Self.jsonString(["changed": changed.map(Self.jsonObject), "removed": removed])
    } else {
      text = Self.jsonString(published.map(Self.jsonObject))
    }
    currentVersion = version
    elementsByID = current
    runtimeByID = Dictionary(
      uniqueKeysWithValues: zip(published, bounded).map { ($0.id, $1.runtimeID) })
    secureIDs = Set(zip(published, bounded).compactMap { $1.secure ? $0.id : nil })
    return NativeAXTreeSnapshot(
      treeVersion: version, mode: mode, text: text, elements: published,
      sensitiveRegions: bounded.filter(\.secure).map(\.bounds)
    )
  }

  public func resolve(elementID: String, treeVersion: String) throws -> String {
    guard currentVersion == treeVersion else { throw NativeControlPolicyError.staleTree }
    guard let runtime = runtimeByID[elementID] else {
      throw NativeControlPolicyError.elementNotFound
    }
    return runtime
  }

  public func assertWritable(elementID: String, treeVersion: String) throws {
    _ = try resolve(elementID: elementID, treeVersion: treeVersion)
    guard !secureIDs.contains(elementID) else { throw NativeControlPolicyError.sensitiveElement }
  }

  public mutating func invalidate() {
    currentVersion = nil
    elementsByID.removeAll(keepingCapacity: true)
    runtimeByID.removeAll(keepingCapacity: true)
    secureIDs.removeAll(keepingCapacity: true)
  }

  private func sanitize(_ element: NativeAXRawElement) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: element.runtimeID.isEmpty ? "unknown" : element.runtimeID,
      role: boundedString(element.role, max: 120, fallback: "unknown"),
      name: boundedString(element.name, max: 2_000),
      value: element.secure
        ? nil : element.value.map { boundedString($0, max: maxNativeTextUTF16Units) },
      bounds: sanitizedRect(element.bounds), enabled: element.enabled, focused: element.focused,
      actions: Array(element.actions.filter(Self.allowedActions.contains).prefix(20)),
      secure: element.secure
    )
  }

  private static let allowedActions: Set<String> = [
    "invoke", "set_value", "select", "scroll", "focus", "expand", "collapse",
  ]

  private static func jsonObject(_ element: NativeAXElementRef) -> [String: Any] {
    var result: [String: Any] = [
      "id": element.id, "treeVersion": element.treeVersion, "role": element.role,
      "name": element.name,
      "bounds": [
        "x": element.bounds.x, "y": element.bounds.y, "width": element.bounds.width,
        "height": element.bounds.height,
      ],
      "enabled": element.enabled, "focused": element.focused, "actions": element.actions,
    ]
    if let value = element.value { result["value"] = value }
    return result
  }

  private static func jsonString(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject(value),
      let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
      data.count <= 2_000_000
    else { return "[]" }
    return String(decoding: data, as: UTF8.self)
  }
}

private func boundedString(_ value: String, max: Int, fallback: String = "") -> String {
  var result = ""
  result.reserveCapacity(min(value.count, max))
  var units = 0
  for character in value {
    if character.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) {
      continue
    }
    let count = String(character).utf16.count
    if units + count > max { break }
    result.append(character)
    units += count
  }
  return result.isEmpty && !fallback.isEmpty ? fallback : result
}

private func sanitizedRect(_ value: NativeRect) -> NativeRect {
  let limit = 131_072.0
  return NativeRect(
    x: value.x.isFinite ? min(limit, max(-limit, value.x)) : 0,
    y: value.y.isFinite ? min(limit, max(-limit, value.y)) : 0,
    width: value.width.isFinite && value.width > 0 ? min(limit, value.width) : 1,
    height: value.height.isFinite && value.height > 0 ? min(limit, value.height) : 1
  )
}
