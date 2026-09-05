import CryptoKit
import Foundation

public enum NativeAccessibilityCachePolicy {
  public static func canReuse(
    sameTarget: Bool,
    subscriptionActive: Bool,
    cachedElementCount: Int,
    cachedGeneration: UInt64,
    currentGeneration: UInt64,
    age: TimeInterval,
    maxAge: TimeInterval
  ) -> Bool {
    sameTarget && subscriptionActive && cachedElementCount > 0
      && cachedGeneration == currentGeneration && age >= 0 && age <= maxAge
  }
}

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
  /// Tree depth of the element (0 = window). The collector emits elements in
  /// pre-order, so `depth` is what turns the flat list back into an outline.
  public let depth: Int
  /// AXRoleDescription when the app provides one ("push button", "search field").
  /// Human wording beats the raw AXRole for the model-facing outline.
  public let roleDescription: String?
  /// AXPlaceholderValue for empty text fields, collected only for text-ish roles.
  public let placeholder: String?
  /// AXSelected for roles that expose selection state (rows, tabs, menu items).
  public let selected: Bool
  /// Total number of AX children the container reported. When the collector
  /// capped recursion (`maxChildrenPerContainer`), this exceeds the number of
  /// children actually visited and the renderer notes the truncation.
  public let childCount: Int

  public init(
    runtimeID: String, role: String, name: String, value: String?, bounds: NativeRect,
    enabled: Bool, focused: Bool, actions: [String], secure: Bool, depth: Int = 0,
    roleDescription: String? = nil, placeholder: String? = nil, selected: Bool = false,
    childCount: Int = 0
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
    self.depth = depth
    self.roleDescription = roleDescription
    self.placeholder = placeholder
    self.selected = selected
    self.childCount = childCount
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
  private var currentVersion: String?
  private var elementsByID: [String: NativeAXElementRef] = [:]
  private var runtimeByID: [String: String] = [:]
  private var secureIDs: Set<String> = []

  public init() {}

  /// Publishes a traversal as the model-facing Markdown outline.
  ///
  /// Key differences from the previous JSON publisher:
  ///  - `treeVersion` is a pure content hash (no publish counter), so an
  ///    unchanged UI yields an identical version across frames. Callers can
  ///    detect "nothing changed" by version equality instead of diffing.
  ///  - Element ids are dense render-line indexes ("1", "2", …) — the same
  ///    ids the model sees as `[n]` markers in the outline. Short, readable,
  ///    and always in sync with the rendered text.
  ///  - The wire diff mode is gone: it was keyed on index-derived ids that
  ///    churned on any sibling insertion, so the diff was effectively always
  ///    "everything changed" while still paying reconciliation complexity.
  ///    The TS reconciler only acts on `diff` mode, so hosts that still emit
  ///    it (Windows) keep working unchanged.
  public mutating func publish(
    elements rawElements: [NativeAXRawElement], previousTreeVersion: String?, fullTree: Bool
  ) -> NativeAXTreeSnapshot {
    let bounded = rawElements.prefix(maxNativeTreeElements).map(sanitize)
    let rendered = NativeAXTreeRenderer.render(bounded)
    var versionHasher = SHA256()
    versionHasher.update(data: Data(rendered.text.utf8))
    versionHasher.update(data: Data("\(bounded.count)".utf8))
    let version = "tree-"
      + versionHasher.finalize().prefix(16).map { String(format: "%02x", $0) }.joined()
    var rawByRuntime: [String: NativeAXRawElement] = [:]
    rawByRuntime.reserveCapacity(bounded.count)
    for element in bounded {
      if rawByRuntime[element.runtimeID] == nil {
        rawByRuntime[element.runtimeID] = element
      }
    }
    let published: [NativeAXElementRef] = rendered.lines.map { line in
      // Lines are rendered from `bounded`; a missing mapping would be a
      // renderer bug, so fall back to an unknown element rather than crash.
      let element = rawByRuntime[line.runtimeID] ?? bounded.first ?? NativeAXRawElement(
        runtimeID: line.runtimeID, role: "AXUnknown", name: "", value: nil,
        bounds: NativeRect(x: 0, y: 0, width: 1, height: 1), enabled: false, focused: false,
        actions: [], secure: false)
      return NativeAXElementRef(
        id: line.elementID, treeVersion: version, role: element.role, name: element.name,
        value: element.secure ? nil : element.value, bounds: element.bounds,
        enabled: element.enabled, focused: element.focused,
        actions: Array(element.actions.prefix(20))
      )
    }
    currentVersion = version
    elementsByID = Dictionary(uniqueKeysWithValues: published.map { ($0.id, $0) })
    runtimeByID = Dictionary(
      uniqueKeysWithValues: zip(published, rendered.lines).map { ($0.id, $1.runtimeID) })
    secureIDs = Set(
      zip(published, rendered.lines)
        .compactMap { rawByRuntime[$1.runtimeID]?.secure == true ? $0.id : nil })
    return NativeAXTreeSnapshot(
      treeVersion: version, mode: .full, text: rendered.text, elements: published,
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
      secure: element.secure,
      depth: min(max(element.depth, 0), 64),
      roleDescription: element.roleDescription.map { boundedString($0, max: 60) },
      placeholder: element.placeholder.map { boundedString($0, max: 160) },
      selected: element.selected,
      childCount: min(max(element.childCount, 0), 1_000_000)
    )
  }

  private static let allowedActions: Set<String> = [
    "invoke", "set_value", "select", "scroll", "focus", "expand", "collapse",
  ]
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
