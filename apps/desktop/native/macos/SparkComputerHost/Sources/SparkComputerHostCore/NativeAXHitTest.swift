import Foundation

/// The interaction capability a coordinate-to-element translation needs from the cached
/// AX tree. Mirrors the semantic capability names published with each element ref.
public enum NativeAXHitCapability: Equatable, Sendable {
  /// click -> AXPress / AXConfirm / AXPick
  case pressable
  /// scroll -> AXIncrement / AXDecrement (AXScroll* family)
  case scrollable
  /// type_text -> AXSetValue
  case textInput
}

public enum NativeAXHitTest {
  /// Selects the smallest-area element that contains the point and supports the
  /// capability. The search runs over the observed window's own cached tree, so it is
  /// deliberately independent of window-server z-order: occluding windows can never
  /// hijack the hit (unlike AXUIElementCopyElementAtPosition).
  public static func target(
    at point: NativeScreenPoint,
    in elements: [NativeAXElementRef],
    capability: NativeAXHitCapability
  ) -> NativeAXElementRef? {
    guard point.x.isFinite, point.y.isFinite else { return nil }
    var best: NativeAXElementRef?
    var bestArea = Double.infinity
    for element in elements {
      guard supports(capability, actions: element.actions) else { continue }
      guard contains(point, bounds: element.bounds) else { continue }
      let area = element.bounds.width * element.bounds.height
      if area < bestArea {
        bestArea = area
        best = element
      }
    }
    return best
  }

  public static func supports(_ capability: NativeAXHitCapability, actions: [String]) -> Bool {
    switch capability {
    case .pressable:
      return actions.contains("invoke") || actions.contains("select")
    case .scrollable:
      return actions.contains("scroll")
    case .textInput:
      return actions.contains("set_value")
    }
  }

  /// Closed on every edge so a point mapped from the window's right/bottom boundary
  /// still resolves to the element that owns it.
  static func contains(_ point: NativeScreenPoint, bounds: NativeRect) -> Bool {
    point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  }
}

/// Decides when a `foreground_input` envelope may first be attempted in the background
/// over the cached AX tree, and which failures abort instead of falling back to the
/// foreground HID path.
public enum NativeBackgroundActionPolicy {
  /// move/drag/keypress depend on a real event stream and stay foreground-only.
  public static func isEligible(_ action: NativeComputerAction) -> Bool {
    switch action {
    case .click, .scroll, .typeText:
      return true
    default:
      return false
    }
  }

  /// Actions the CGEventPostToPid channel can deliver straight to the target
  /// process without focus: the full mouse class (click with any button,
  /// move, drag, pixel-precise scroll) plus keyboard chords and unicode text.
  /// This is strictly wider than the AX channel because synthesized events do
  /// not need the element to expose an AX action.
  public static func isPidEligible(_ action: NativeComputerAction) -> Bool {
    switch action {
    case .click, .move, .drag, .scroll, .keypress, .typeText:
      return true
    default:
      return false
    }
  }

  /// Errors that must propagate: falling back to the foreground HID path would bypass
  /// the protection the error represents (session authority, secure-input guard).
  public static func mustAbort(_ error: NativeHostPlatformError) -> Bool {
    switch error {
    case .sessionCanceled, .sensitiveInputBlocked:
      return true
    default:
      return false
    }
  }

  /// AXIncrement/AXDecrement steps used to approximate a pixel-delta wheel motion.
  public static func scrollStepCount(
    forDelta delta: Double,
    step: Double = 120,
    maxSteps: Int = 20
  ) -> Int {
    guard delta != 0, delta.isFinite, step > 0, step.isFinite else { return 0 }
    return max(1, min(maxSteps, Int((abs(delta) / step).rounded(.up))))
  }
}

/// US-layout shifted symbols that `keypress` chords may name, mapped to the base
/// character whose virtual keycode they share. The CGEvent path re-creates the shift
/// modifier for these keys.
public enum NativeKeySymbols {
  public static let shiftedToBase: [String: String] = [
    "~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
    "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
    "_": "-", "+": "=", "{": "[", "}": "]", ":": ";", "\"": "'",
    "<": ",", ">": ".", "?": "/", "|": "\\",
  ]

  public static func isShiftedSymbol(_ key: String) -> Bool {
    shiftedToBase.keys.contains(key)
  }

  public static func baseCharacter(for key: String) -> String? {
    shiftedToBase[key]
  }
}
