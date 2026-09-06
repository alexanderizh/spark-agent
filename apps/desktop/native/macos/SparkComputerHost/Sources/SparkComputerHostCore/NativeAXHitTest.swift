import CoreGraphics
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
  /// When no element contains the point, snap to the nearest capable element
  /// within this distance (pt) — model-mapped coordinates routinely miss tiny
  /// controls by a few pixels, and a hard miss turned into a click on whatever
  /// sat under the point instead. Mirrors Codex's CloseEnough snapping.
  public static let closeEnoughThresholdPt = 12.0

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
    var nearest: NativeAXElementRef?
    var nearestDistance = closeEnoughThresholdPt
    for element in elements {
      guard supports(capability, actions: element.actions) else { continue }
      if contains(point, bounds: element.bounds) {
        let area = element.bounds.width * element.bounds.height
        if area < bestArea {
          bestArea = area
          best = element
        }
        continue
      }
      if let distance = distance(from: point, to: element.bounds), distance < nearestDistance {
        nearestDistance = distance
        nearest = element
      }
    }
    return best ?? nearest
  }

  static func distance(from point: NativeScreenPoint, to bounds: NativeRect) -> Double? {
    guard bounds.width.isFinite, bounds.height.isFinite, bounds.width >= 0, bounds.height >= 0
    else { return nil }
    let dx = max(max(bounds.x - point.x, 0), point.x - (bounds.x + bounds.width))
    let dy = max(max(bounds.y - point.y, 0), point.y - (bounds.y + bounds.height))
    return (dx * dx + dy * dy).squareRoot()
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
    case .click, .move, .drag, .scroll, .keypress, .typeText, .pasteText:
      return true
    default:
      return false
    }
  }

  /// Errors that must propagate: falling back to the foreground HID path would bypass
  /// the protection the error represents (session authority, secure-input guard,
  /// user takeover). `userTakeover` covers the Esc interruption token — swallowing
  /// it here made an Esc-cancelled action replay in full on the foreground path.
  /// `screenLocked` aborts because no channel can deliver input to a locked display.
  public static func mustAbort(_ error: NativeHostPlatformError) -> Bool {
    switch error {
    case .sessionCanceled, .sensitiveInputBlocked, .userTakeover, .screenLocked:
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

/// Modifier chords for mouse actions — cmd+click (open in new tab), ctrl+click
/// (context menu on macOS), shift+click. The names match the keypress chord
/// vocabulary so the model uses one set of modifier names everywhere.
public enum NativeMouseChord {
  public static let allowedNames = ["Meta", "Control", "Alt", "Shift"]

  public static func flags(for modifiers: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for modifier in modifiers {
      switch modifier {
      case "Meta": flags.insert(.maskCommand)
      case "Control": flags.insert(.maskControl)
      case "Alt": flags.insert(.maskAlternate)
      case "Shift": flags.insert(.maskShift)
      default: break
      }
    }
    return flags
  }
}

/// Console-session lock state (Codex returns `screenLocked` in the same
/// situation): while the session is locked, no action or observation makes
/// sense and the model should ask the user to unlock instead of retrying.
public enum NativeLockScreen {
  /// `CGSessionCopyCurrentDictionary` exposes `CGSSessionScreenIsLocked` while
  /// the console session shows the lock screen — the same key Codex's lock
  /// screen Guardian polls.
  public static func isLocked(session: CFDictionary? = CGSessionCopyCurrentDictionary())
    -> Bool
  {
    guard let session else { return false }
    let dictionary = session as NSDictionary
    return (dictionary["CGSSessionScreenIsLocked"] as? NSNumber)?.boolValue ?? false
  }
}
