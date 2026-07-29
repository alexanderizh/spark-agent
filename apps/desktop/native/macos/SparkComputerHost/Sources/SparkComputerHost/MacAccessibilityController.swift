import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import SparkComputerHostCore

final class MacAccessibilityController {
  private static let maxDepth = 48
  private static let maxElements = maxNativeTreeElements

  private var tree = NativeAXTreeState()
  private var elementsByRuntimeID: [String: AXUIElement] = [:]
  private var boundsByElementID: [String: NativeRect] = [:]

  var isAvailable: Bool {
    AXIsProcessTrusted()
  }

  func observe(
    processID: pid_t,
    previousTreeVersion: String?,
    fullTree: Bool
  ) throws -> NativeAXTreeSnapshot {
    guard AXIsProcessTrusted() else { throw NativeHostPlatformError.accessibilityPermissionDenied }
    let application = AXUIElementCreateApplication(processID)
    AXUIElementSetMessagingTimeout(application, 2)
    guard let focusedWindow: AXUIElement = copyAttribute(application, kAXFocusedWindowAttribute)
    else { throw NativeHostPlatformError.focusMismatch }
    var actualPID: pid_t = 0
    guard AXUIElementGetPid(focusedWindow, &actualPID) == .success, actualPID == processID else {
      throw NativeHostPlatformError.focusMismatch
    }

    var raw: [NativeAXRawElement] = []
    var elements: [String: AXUIElement] = [:]
    try collect(
      focusedWindow, path: "window", depth: 0, output: &raw, elements: &elements)
    let snapshot = tree.publish(
      elements: raw, previousTreeVersion: previousTreeVersion, fullTree: fullTree)
    guard snapshot.elements.count <= Self.maxElements, snapshot.text.utf16.count <= 2_000_000 else {
      tree.invalidate()
      throw NativeHostPlatformError.resourceLimitExceeded
    }
    elementsByRuntimeID = elements
    boundsByElementID = Dictionary(
      uniqueKeysWithValues: snapshot.elements.map { ($0.id, $0.bounds) })
    return snapshot
  }

  func execute(_ action: NativeComputerAction, treeVersion: String) throws -> NativeActionStatus {
    switch action {
    case .invokeElement(let elementID, let requestedAction):
      let element = try resolve(elementID, treeVersion: treeVersion)
      try performSemanticAction(requestedAction ?? "invoke", on: element)
    case .setValue(let elementID, let value, _):
      try NativeInputPolicy.validateText(value, allowEmpty: true)
      try tree.assertWritable(elementID: elementID, treeVersion: treeVersion)
      let element = try resolve(elementID, treeVersion: treeVersion)
      guard isSettable(element, kAXValueAttribute),
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
          == .success
      else { throw NativeHostPlatformError.actionNoop }
    case .selectText(let elementID, let text, let prefix, let suffix):
      try tree.assertWritable(elementID: elementID, treeVersion: treeVersion)
      let element = try resolve(elementID, treeVersion: treeVersion)
      try selectText(text, prefix: prefix, suffix: suffix, in: element)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    return .executed
  }

  func contains(elementID: String, treeVersion: String) -> Bool {
    guard
      let runtimeID = try? tree.resolve(
        elementID: elementID, treeVersion: treeVersion),
      let element = elementsByRuntimeID[runtimeID]
    else { return false }
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success
  }

  func bounds(elementID: String, treeVersion: String) throws -> NativeRect {
    _ = try resolve(elementID, treeVersion: treeVersion)
    guard let bounds = boundsByElementID[elementID] else {
      throw NativeHostPlatformError.staleTree
    }
    return bounds
  }

  func loadingStopped(processID: pid_t) -> Bool {
    let application = AXUIElementCreateApplication(processID)
    guard let window: AXUIElement = copyAttribute(application, kAXFocusedWindowAttribute)
    else { return false }
    return !((copyAttribute(window, "AXElementBusy") as NSNumber?)?.boolValue ?? false)
  }

  func focusedElementIsSecure(processID: pid_t) -> Bool {
    let application = AXUIElementCreateApplication(processID)
    guard let element: AXUIElement = copyAttribute(application, kAXFocusedUIElementAttribute)
    else { return false }
    return isSecure(element)
  }

  func invalidate() {
    tree.invalidate()
    elementsByRuntimeID.removeAll(keepingCapacity: true)
    boundsByElementID.removeAll(keepingCapacity: true)
  }

  private func resolve(_ elementID: String, treeVersion: String) throws -> AXUIElement {
    let runtimeID: String
    do {
      runtimeID = try tree.resolve(elementID: elementID, treeVersion: treeVersion)
    } catch NativeControlPolicyError.staleTree {
      throw NativeHostPlatformError.staleTree
    } catch {
      throw NativeHostPlatformError.staleTree
    }
    guard let element = elementsByRuntimeID[runtimeID] else {
      throw NativeHostPlatformError.staleTree
    }
    var processID: pid_t = 0
    guard AXUIElementGetPid(element, &processID) == .success, processID > 0 else {
      throw NativeHostPlatformError.staleTree
    }
    return element
  }

  private func collect(
    _ element: AXUIElement,
    path: String,
    depth: Int,
    output: inout [NativeAXRawElement],
    elements: inout [String: AXUIElement]
  ) throws {
    guard depth <= Self.maxDepth, output.count < Self.maxElements else { return }
    let role: String = copyAttribute(element, kAXRoleAttribute) ?? "unknown"
    let subrole: String = copyAttribute(element, kAXSubroleAttribute) ?? ""
    let identifier: String = copyAttribute(element, kAXIdentifierAttribute) ?? ""
    let runtimeID = "\(path)|\(role)|\(identifier)"
    let secure = isSecure(element, role: role, subrole: subrole)
    let name = firstNonempty([
      copyAttribute(element, kAXTitleAttribute),
      copyAttribute(element, kAXDescriptionAttribute),
      copyAttribute(element, kAXHelpAttribute),
    ])
    let value: String?
    if secure {
      value = nil
    } else if let string: String = copyAttribute(element, kAXValueAttribute) {
      value = string
    } else if let number: NSNumber = copyAttribute(element, kAXValueAttribute) {
      value = number.stringValue
    } else {
      value = nil
    }
    let enabled: Bool =
      (copyAttribute(element, kAXEnabledAttribute) as NSNumber?)?.boolValue ?? true
    let focused: Bool =
      (copyAttribute(element, kAXFocusedAttribute) as NSNumber?)?.boolValue ?? false
    let bounds = elementBounds(element)
    let actions = supportedActions(element, secure: secure)
    output.append(
      NativeAXRawElement(
        runtimeID: runtimeID, role: role, name: name, value: value, bounds: bounds,
        enabled: enabled, focused: focused, actions: actions, secure: secure
      )
    )
    elements[runtimeID] = element
    let children: [AXUIElement] = copyAttribute(element, kAXChildrenAttribute) ?? []
    for (index, child) in children.enumerated() {
      if output.count >= Self.maxElements { break }
      try collect(
        child, path: "\(path).\(index)", depth: depth + 1, output: &output,
        elements: &elements)
    }
  }

  private func supportedActions(_ element: AXUIElement, secure: Bool) -> [String] {
    var rawNames: CFArray?
    let names: [String]
    if AXUIElementCopyActionNames(element, &rawNames) == .success,
      let array = rawNames as? [String]
    {
      names = array
    } else {
      names = []
    }
    var result: [String] = []
    if names.contains(kAXPressAction as String) || names.contains(kAXConfirmAction as String) {
      result.append("invoke")
    }
    if names.contains("AXPick") { result.append("select") }
    if isSettable(element, kAXFocusedAttribute) || names.contains(kAXRaiseAction as String) {
      result.append("focus")
    }
    if isSettable(element, kAXExpandedAttribute) {
      result.append(contentsOf: ["expand", "collapse"])
    }
    if !secure, isSettable(element, kAXValueAttribute) { result.append("set_value") }
    if !secure, isSettable(element, kAXSelectedTextRangeAttribute) { result.append("select") }
    if names.contains(where: { $0.hasPrefix("AXScroll") }) { result.append("scroll") }
    return Array(Set(result)).sorted()
  }

  private func performSemanticAction(_ action: String, on element: AXUIElement) throws {
    let result: AXError
    switch action {
    case "invoke":
      let available = actionNames(element)
      let name =
        available.contains(kAXPressAction as String)
        ? kAXPressAction as CFString : kAXConfirmAction as CFString
      result = AXUIElementPerformAction(element, name)
    case "select":
      result = AXUIElementPerformAction(element, "AXPick" as CFString)
    case "focus":
      result = AXUIElementSetAttributeValue(
        element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    case "expand":
      result = AXUIElementSetAttributeValue(
        element, kAXExpandedAttribute as CFString, kCFBooleanTrue)
    case "collapse":
      result = AXUIElementSetAttributeValue(
        element, kAXExpandedAttribute as CFString, kCFBooleanFalse)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    guard result == .success else { throw NativeHostPlatformError.actionNoop }
  }

  private func selectText(
    _ needle: String, prefix: String?, suffix: String?, in element: AXUIElement
  ) throws {
    guard let value: String = copyAttribute(element, kAXValueAttribute) else {
      throw NativeHostPlatformError.actionNoop
    }
    let nsValue = value as NSString
    var searchRange = NSRange(location: 0, length: nsValue.length)
    var selected: NSRange?
    while searchRange.length >= 0 {
      let match = nsValue.range(of: needle, options: [], range: searchRange)
      if match.location == NSNotFound { break }
      let beforeMatches =
        prefix.map { prefixValue in
          match.location >= (prefixValue as NSString).length
            && nsValue.substring(
              with: NSRange(
                location: match.location - (prefixValue as NSString).length,
                length: (prefixValue as NSString).length)) == prefixValue
        } ?? true
      let afterMatches =
        suffix.map { suffixValue in
          let start = match.location + match.length
          return start + (suffixValue as NSString).length <= nsValue.length
            && nsValue.substring(
              with: NSRange(
                location: start, length: (suffixValue as NSString).length)) == suffixValue
        } ?? true
      if beforeMatches && afterMatches {
        selected = match
        break
      }
      let next = match.location + max(match.length, 1)
      if next > nsValue.length { break }
      searchRange = NSRange(location: next, length: nsValue.length - next)
    }
    guard var range = selected,
      let axRange = AXValueCreate(.cfRange, &range),
      AXUIElementSetAttributeValue(
        element, kAXSelectedTextRangeAttribute as CFString, axRange) == .success
    else { throw NativeHostPlatformError.actionNoop }
  }
}

private func copyAttribute<Value>(
  _ element: AXUIElement, _ attribute: String
) -> Value? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
    let value
  else { return nil }
  return value as? Value
}

private func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
  var settable = DarwinBoolean(false)
  return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success
    && settable.boolValue
}

private func actionNames(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return names as? [String] ?? []
}

private func firstNonempty(_ values: [String?]) -> String {
  values.compactMap { $0 }.first { !$0.isEmpty } ?? ""
}

private func elementBounds(_ element: AXUIElement) -> NativeRect {
  var origin = CGPoint.zero
  var size = CGSize(width: 1, height: 1)
  if let value: AXValue = copyAttribute(element, kAXPositionAttribute),
    AXValueGetType(value) == .cgPoint
  {
    AXValueGetValue(value, .cgPoint, &origin)
  }
  if let value: AXValue = copyAttribute(element, kAXSizeAttribute),
    AXValueGetType(value) == .cgSize
  {
    AXValueGetValue(value, .cgSize, &size)
  }
  return NativeRect(
    x: origin.x, y: origin.y, width: max(1, size.width), height: max(1, size.height))
}

private func isSecure(
  _ element: AXUIElement, role: String? = nil, subrole: String? = nil
) -> Bool {
  let role = role ?? copyAttribute(element, kAXRoleAttribute) ?? ""
  let subrole = subrole ?? copyAttribute(element, kAXSubroleAttribute) ?? ""
  let protected = (copyAttribute(element, "AXProtectedContent") as NSNumber?)?.boolValue ?? false
  let marker = "\(role) \(subrole)".lowercased()
  return protected || marker.contains("securetextfield") || marker.contains("password")
}

enum MacCGEventController {
  static var isAvailable: Bool {
    CGPreflightPostEventAccess() && CGEventSource(stateID: .hidSystemState) != nil
  }

  static func execute(
    _ action: NativeComputerAction,
    windowBounds: NativeRect,
    scrollTargetBounds: NativeRect? = nil,
    validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws -> NativeActionStatus {
    guard isAvailable else { throw NativeHostPlatformError.accessibilityPermissionDenied }
    switch action {
    case .click(let normalized, let button, let count):
      let point = try map(normalized, bounds: windowBounds)
      let mouseButton = cgButton(button)
      let types = mouseTypes(button)
      for index in 0..<(count ?? 1) {
        try await validateTarget()
        guard
          let down = CGEvent(
            mouseEventSource: nil, mouseType: types.0, mouseCursorPosition: point,
            mouseButton: mouseButton),
          let up = CGEvent(
            mouseEventSource: nil, mouseType: types.1, mouseCursorPosition: point,
            mouseButton: mouseButton)
        else { throw NativeHostPlatformError.actionNoop }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
      }
    case .move(let normalized):
      try await validateTarget()
      let point = try map(normalized, bounds: windowBounds)
      guard
        let event = CGEvent(
          mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point,
          mouseButton: .left)
      else { throw NativeHostPlatformError.actionNoop }
      event.post(tap: .cghidEventTap)
    case .drag(let from, let to, let durationMs):
      let start = try map(from, bounds: windowBounds)
      let end = try map(to, bounds: windowBounds)
      try postMouse(type: .mouseMoved, at: start, button: .left)
      try await validateTarget()
      try postMouse(type: .leftMouseDown, at: start, button: .left)
      var current = start
      defer { try? postMouse(type: .leftMouseUp, at: current, button: .left) }
      let duration = durationMs ?? 250
      let steps = max(1, min(120, duration / 16))
      for step in 1...steps {
        try await validateTarget()
        let ratio = Double(step) / Double(steps)
        let point = CGPoint(
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio)
        current = point
        try postMouse(type: .leftMouseDragged, at: point, button: .left)
        try await Task.sleep(for: .milliseconds(max(1, duration / steps)))
      }
    case .scroll(_, let normalized, let deltaX, let deltaY):
      try await validateTarget()
      let point: CGPoint
      if let normalized {
        point = try map(normalized, bounds: windowBounds)
      } else if let target = scrollTargetBounds {
        let center = NativeScreenPoint(
          x: target.x + target.width / 2, y: target.y + target.height / 2)
        guard contains(center, in: windowBounds) else {
          throw NativeHostPlatformError.invalidWindowGeometry
        }
        point = CGPoint(x: center.x, y: center.y)
      } else {
        point = try map(NativeNormalizedPoint(x: 0.5, y: 0.5), bounds: windowBounds)
      }
      try postMouse(type: .mouseMoved, at: point, button: .left)
      guard
        let event = CGEvent(
          scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
          wheel1: Int32((-deltaY).rounded()), wheel2: Int32((-deltaX).rounded()), wheel3: 0)
      else { throw NativeHostPlatformError.actionNoop }
      event.post(tap: .cghidEventTap)
    case .keypress(let keys):
      try NativeInputPolicy.validateKeys(keys)
      try await postKeyChord(keys, validateTarget: validateTarget)
    case .typeText(let text, _):
      try NativeInputPolicy.validateText(text)
      try await postText(text, validateTarget: validateTarget)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    return .executed
  }

  private static func map(_ point: NativeNormalizedPoint, bounds: NativeRect) throws -> CGPoint {
    let mapped = try NativeInputPolicy.screenPoint(
      normalizedX: point.x, normalizedY: point.y, windowBounds: bounds)
    return CGPoint(x: mapped.x, y: mapped.y)
  }

  private static func contains(_ point: NativeScreenPoint, in bounds: NativeRect) -> Bool {
    point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  }

  private static func postMouse(type: CGEventType, at point: CGPoint, button: CGMouseButton) throws
  {
    guard
      let event = CGEvent(
        mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    else { throw NativeHostPlatformError.actionNoop }
    event.post(tap: .cghidEventTap)
  }

  private static func cgButton(_ value: String?) -> CGMouseButton {
    switch value {
    case "right": .right
    case "middle": .center
    default: .left
    }
  }

  private static func mouseTypes(_ value: String?) -> (CGEventType, CGEventType) {
    switch value {
    case "right": (.rightMouseDown, .rightMouseUp)
    case "middle": (.otherMouseDown, .otherMouseUp)
    default: (.leftMouseDown, .leftMouseUp)
    }
  }

  private static func postKeyChord(
    _ keys: [String], validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws {
    var flags: CGEventFlags = []
    for key in keys {
      switch key {
      case "Meta": flags.insert(.maskCommand)
      case "Control": flags.insert(.maskControl)
      case "Alt": flags.insert(.maskAlternate)
      case "Shift": flags.insert(.maskShift)
      default: continue
      }
    }
    let nonModifiers = keys.filter { !["Meta", "Control", "Alt", "Shift"].contains($0) }
    guard !nonModifiers.isEmpty else { throw NativeHostPlatformError.actionNotAllowed }
    for key in nonModifiers {
      try await validateTarget()
      if let code = keyCode(key) {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        else { throw NativeHostPlatformError.actionNoop }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
      } else {
        throw NativeHostPlatformError.actionNotAllowed
      }
    }
  }

  private static func postText(
    _ text: String, validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws {
    var chunk = ""
    for scalar in text.unicodeScalars {
      let value = String(scalar)
      if chunk.utf16.count + value.utf16.count > 32 {
        try await validateTarget()
        try postUnicode(chunk, flags: [])
        try await Task.sleep(for: .milliseconds(2))
        chunk = ""
      }
      chunk.append(value)
    }
    if !chunk.isEmpty {
      try await validateTarget()
      try postUnicode(chunk, flags: [])
    }
  }

  private static func postUnicode(_ text: String, flags: CGEventFlags) throws {
    let units = Array(text.utf16)
    guard !units.isEmpty, units.count <= 32,
      let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
      let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
    else { throw NativeHostPlatformError.actionNoop }
    units.withUnsafeBufferPointer { buffer in
      down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
      up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
  }

  private static func keyCode(_ value: String) -> CGKeyCode? {
    let named: [String: CGKeyCode] = [
      "Backspace": 51, "Delete": 117, "End": 119, "Enter": 36, "Escape": 53,
      "Home": 115, "PageDown": 121, "PageUp": 116, "Space": 49, "Tab": 48,
      "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124, "ArrowUp": 126,
      "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
      "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
      "F13": 105, "F14": 107, "F15": 113, "F16": 106, "F17": 64, "F18": 79,
      "F19": 80, "F20": 90,
    ]
    if let code = named[value] { return code }
    let ascii: [Character: CGKeyCode] = [
      "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
      "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15, "Y": 16,
      "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
      "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30,
      "O": 31, "U": 32, "[": 33, "I": 34, "P": 35, "L": 37, "J": 38,
      "'": 39, "K": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "N": 45,
      "M": 46, ".": 47, "`": 50,
    ]
    guard value.count == 1, let character = value.uppercased().first else { return nil }
    return ascii[character]
  }
}
