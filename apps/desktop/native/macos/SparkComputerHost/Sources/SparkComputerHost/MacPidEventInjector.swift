import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import SparkComputerHostCore

/// Background input channel: delivers synthesized CGEvents directly to the
/// target process (`CGEventPostToPid`) instead of the global HID stream.
///
/// This is the transport the reverse-engineered Codex computer-use service
/// uses for non-frontmost control: the event bypasses the window server's
/// global hit-testing, so a fully occluded background window still receives
/// clicks — including clicks on custom-drawn/canvas areas that expose no AX
/// actions. It never steals the user's focus: the foreground app stays
/// untouched, and events do not traverse the global event tap.
///
/// Best-effort preparation before posting (`prepareWindow`): AXRaise the
/// target window (raises z-order within the app without activating) and post
/// the "application activated" notification some apps require before they
/// respond to background input. Failures here do not block the injection —
/// many apps respond fine without it.
enum MacPidEventInjector {
  static var isAvailable: Bool {
    MacCGEventController.isAvailable
  }

  // Codex's measured human click rhythm: ~0.1s between press pairs, a short
  // press duration for down→up.
  private static let pressDownMs: UInt64 = 40
  private static let interClickMs: UInt64 = 100
  private static let dragStepMs: UInt64 = 16

  static func click(
    pid: pid_t,
    at point: CGPoint,
    button: String?,
    count: Int
  ) async throws {
    let mouseButton = cgButton(button)
    let types = mouseTypes(button)
    for index in 0..<max(1, min(3, count)) {
      let down = try makeMouseEvent(type: types.0, at: point, button: mouseButton)
      let up = try makeMouseEvent(type: types.1, at: point, button: mouseButton)
      down.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
      up.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
      tag(down)
      tag(up)
      down.postToPid(pid)
      try? await Task.sleep(for: .milliseconds(pressDownMs))
      up.postToPid(pid)
      if index < count - 1 {
        try? await Task.sleep(for: .milliseconds(interClickMs))
      }
    }
  }

  /// Cursor-synced click: the virtual cursor presses and releases in lock
  /// step with the injected events so the user sees the click land.
  static func clickWithCursor(
    pid: pid_t,
    at point: CGPoint,
    button: String?,
    count: Int
  ) async throws {
    let mouseButton = cgButton(button)
    let types = mouseTypes(button)
    for index in 0..<max(1, min(3, count)) {
      let down = try makeMouseEvent(type: types.0, at: point, button: mouseButton)
      let up = try makeMouseEvent(type: types.1, at: point, button: mouseButton)
      down.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
      up.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
      tag(down)
      tag(up)
      down.postToPid(pid)
      MacVirtualCursor.pressDown()
      try? await Task.sleep(for: .milliseconds(pressDownMs))
      up.postToPid(pid)
      MacVirtualCursor.pressUp()
      if index < count - 1 {
        try? await Task.sleep(for: .milliseconds(interClickMs))
      }
    }
  }

  static func scroll(pid: pid_t, at point: CGPoint, deltaX: Double, deltaY: Double) throws {
    let hover = try makeMouseEvent(type: .mouseMoved, at: point, button: .left)
    tag(hover)
    hover.postToPid(pid)
    guard
      let event = CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
        wheel1: Int32((-deltaY).rounded()), wheel2: Int32((-deltaX).rounded()), wheel3: 0)
    else { throw NativeHostPlatformError.actionNoop }
    tag(event)
    event.postToPid(pid)
  }

  static func drag(
    pid: pid_t,
    from start: CGPoint,
    to end: CGPoint,
    durationMs: Int
  ) async throws {
    try await performDrag(pid: pid, start: start, end: end, durationMs: durationMs)
  }

  /// Cursor-synced drag: the virtual cursor travels along the same path.
  static func dragWithCursor(
    pid: pid_t,
    from start: CGPoint,
    to end: CGPoint,
    durationMs: Int
  ) async throws {
    try await performDrag(pid: pid, start: start, end: end, durationMs: durationMs, cursor: true)
  }

  private static func performDrag(
    pid: pid_t, start: CGPoint, end: CGPoint, durationMs: Int, cursor: Bool = false
  ) async throws {
    let move = try makeMouseEvent(type: .mouseMoved, at: start, button: .left)
    tag(move)
    move.postToPid(pid)
    let down = try makeMouseEvent(type: .leftMouseDown, at: start, button: .left)
    tag(down)
    down.postToPid(pid)
    let duration = durationMs
    let steps = max(1, min(120, duration / Int(dragStepMs)))
    for step in 1...steps {
      let ratio = Double(step) / Double(steps)
      let point = CGPoint(x: start.x + (end.x - start.x) * ratio, y: start.y + (end.y - start.y) * ratio)
      let dragged = try makeMouseEvent(type: .leftMouseDragged, at: point, button: .left)
      tag(dragged)
      dragged.postToPid(pid)
      if cursor { MacVirtualCursor.drag(to: point) }
      try? await Task.sleep(for: .milliseconds(max(1, duration / steps)))
    }
    let up = try makeMouseEvent(type: .leftMouseUp, at: end, button: .left)
    tag(up)
    up.postToPid(pid)
  }

  static func typeUnicode(pid: pid_t, text: String) async throws {
    for chunk in chunked(text, limit: 32) {
      let units = Array(chunk.utf16)
      guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
      else { throw NativeHostPlatformError.actionNoop }
      units.withUnsafeBufferPointer { buffer in
        down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
        up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
      }
      tag(down)
      tag(up)
      down.postToPid(pid)
      up.postToPid(pid)
      try? await Task.sleep(for: .milliseconds(8))
    }
  }

  static func keyChord(pid: pid_t, keys: [String], keyCode: (String) -> CGKeyCode?) async throws {
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
      guard let code = keyCode(key) else { throw NativeHostPlatformError.actionNotAllowed }
      guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
      else { throw NativeHostPlatformError.actionNoop }
      down.flags = flags
      up.flags = flags
      tag(down)
      tag(up)
      down.postToPid(pid)
      try? await Task.sleep(for: .milliseconds(pressDownMs))
      up.postToPid(pid)
    }
  }

  /// A tagged hover event the caller posts to a specific pid (mouse move).
  static func makeHoverEvent(at point: CGPoint) throws -> CGEvent {
    guard
      let event = CGEvent(
        mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point,
        mouseButton: .left)
    else { throw NativeHostPlatformError.actionNoop }
    event.setIntegerValueField(.eventSourceUserData, value: sparkComputerInjectedEventTag)
    return event
  }

  /// AXRaise the window matching `bounds` inside the app (z-order only, no
  /// app activation, no focus steal), mark it main, then run the full focus
  /// forgery (`AXApplicationActivated` + key/main window notifications via
  /// the `_AXUIElementPostNotification` SPI and a distributed post). Many
  /// apps ignore background mouse/keyboard events until they believe they are
  /// active; this is the same prep the reverse-engineered Codex service
  /// performs. Best-effort — false just means the app ignored us, injection
  /// is still attempted.
  @discardableResult
  static func prepareWindow(pid: pid_t, bounds: NativeRect) -> Bool {
    let application = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(application, 1)
    guard let windows: [AXUIElement] = copyAttribute(application, kAXWindowsAttribute)
    else {
      MacFocusForger.forgeActivation(pid: pid, window: nil, activationPoint: nil)
      return false
    }
    let best = windows.min(by: { distance($0, bounds) < distance($1, bounds) })
    guard let best else {
      MacFocusForger.forgeActivation(pid: pid, window: nil, activationPoint: nil)
      return false
    }
    let raised = AXUIElementPerformAction(best, kAXRaiseAction as CFString) == .success
    _ = AXUIElementSetAttributeValue(best, kAXMainAttribute as CFString, kCFBooleanTrue)
    let center = CGPoint(x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2)
    MacFocusForger.forgeActivation(pid: pid, window: best, activationPoint: center)
    return raised
  }

  private static func distance(_ element: AXUIElement, _ bounds: NativeRect) -> Double {
    let elementFrame = elementBounds(element)
    return abs(elementFrame.x - bounds.x) + abs(elementFrame.y - bounds.y)
      + abs(elementFrame.width - bounds.width) + abs(elementFrame.height - bounds.height)
  }

  private static func elementBounds(_ element: AXUIElement) -> NativeRect {
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

  private static func makeMouseEvent(
    type: CGEventType, at point: CGPoint, button: CGMouseButton
  ) throws -> CGEvent {
    guard
      let event = CGEvent(
        mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    else { throw NativeHostPlatformError.actionNoop }
    return event
  }

  private static func tag(_ event: CGEvent) {
    event.setIntegerValueField(.eventSourceUserData, value: sparkComputerInjectedEventTag)
  }

  private static func chunked(_ text: String, limit: Int) -> [String] {
    var chunks: [String] = []
    var current = ""
    var units = 0
    for scalar in text.unicodeScalars {
      let value = String(scalar)
      let count = value.utf16.count
      if units + count > limit {
        if !current.isEmpty { chunks.append(current) }
        current = value
        units = count
      } else {
        current.append(value)
        units += count
      }
    }
    if !current.isEmpty { chunks.append(current) }
    return chunks
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

  private static func copyAttribute<Value>(
    _ element: AXUIElement, _ attribute: String
  ) -> Value? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
      let value
    else { return nil }
    return value as? Value
  }
}
