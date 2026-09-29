import ApplicationServices
import Foundation

/// Batched reading of AX attributes.
///
/// A single-element traversal previously issued roughly twenty
/// `AXUIElementCopyAttributeValue` calls (one XPC round trip each: role,
/// subrole, identifier, title, description, help, value, enabled, focused,
/// position, size, role description, protected-content, children, action
/// names, four `AXUIElementIsAttributeSettable` probes). Measured on Finder:
/// ~0.8-2.4 ms per round trip, i.e. the whole traversal cost is dominated by
/// round-trip count rather than by the app answering. `AXUIElementCopyMultipleAttributeValues`
/// answers the same set in **one** round trip.
///
/// The batch reply reports an attribute it could not fetch as either CFNull or
/// an `AXValue` of type `kAXValueAXErrorType` when `options = 0` (Apple:
/// AXUIElement.h, `AXUIElementCopyMultipleAttributeValues` discussion). Both
/// must be normalized to `nil`, otherwise an error object would be handed to
/// the caller as if it were the attribute's value.
public enum NativeAXAttributeBatch {
  /// Attributes needed to decide whether an element is worth keeping, and where
  /// it sits. Read first for every element so offscreen subtrees can be pruned
  /// before the (more expensive) content attributes are fetched.
  public static let identityAttributes: [String] = [
    "AXRole", "AXSubrole", "AXPosition", "AXSize", "AXChildren",
  ]

  /// Attributes that describe what the element says and does.
  public static let contentAttributes: [String] = [
    "AXTitle", "AXDescription", "AXHelp", "AXValue", "AXEnabled", "AXFocused",
    "AXIdentifier", "AXRoleDescription", "AXProtectedContent",
  ]

  /// Read only for text-ish roles whose name/value are both empty.
  public static let placeholderAttributes: [String] = ["AXPlaceholderValue"]

  /// Read only for row/tab/menu-item-like roles.
  public static let selectionAttributes: [String] = ["AXSelected"]

  public static func normalize(_ raw: [Any]) -> [Any?] {
    raw.map { value in
      if value is NSNull { return nil }
      if let axValue: AXValue = typedCast(value), AXValueGetType(axValue) == .axError {
        return nil
      }
      return value
    }
  }

  /// Generic cast helper: a plain `as? AXValue` on `Any` is diagnosed as
  /// "always succeeds" for CoreFoundation types, while the generic form keeps
  /// the dynamic type check (and therefore the same nil behaviour as the
  /// single-attribute reader).
  private static func typedCast<Value>(_ value: Any) -> Value? {
    value as? Value
  }
}

/// Positional reader over one element's batched attribute reply. Mirrors the
/// per-attribute `copyAttribute<Value>(...) as? Value` semantics: if the value
/// is not of the requested type the lookup yields `nil`, exactly as before.
public struct NativeAXAttributeReader {
  private let indexByName: [String: Int]
  private let values: [Any?]

  public init(names: [String], values: [Any?]) {
    var indexByName: [String: Int] = [:]
    indexByName.reserveCapacity(names.count)
    for (index, name) in names.enumerated() where indexByName[name] == nil {
      indexByName[name] = index
    }
    self.indexByName = indexByName
    self.values = values
  }

  public func raw(_ name: String) -> Any? {
    guard let index = indexByName[name], index < values.count else { return nil }
    return values[index]
  }

  public func string(_ name: String) -> String? {
    raw(name) as? String
  }

  public func number(_ name: String) -> NSNumber? {
    raw(name) as? NSNumber
  }

  public func bool(_ name: String) -> Bool? {
    number(name)?.boolValue
  }

  public func axValue(_ name: String) -> AXValue? {
    cast(raw(name))
  }

  private func cast<Value>(_ value: Any?) -> Value? {
    value as? Value
  }

  public func elements(_ name: String) -> [AXUIElement] {
    (raw(name) as? [AXUIElement]) ?? []
  }
}
