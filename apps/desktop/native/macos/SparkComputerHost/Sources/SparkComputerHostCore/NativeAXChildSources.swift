import Foundation

/// Where a container keeps its children.
///
/// `AXChildren` is the documented visual child list, but table/outline style
/// containers expose their content through `AXRows` — Apple's header documents
/// `kAXRowsAttribute` as "an array of the accessibility objects representing the
/// rows in this table or outline view", under the "table/outline view
/// attributes" section, while the `kAXChildrenAttribute` examples are a tab
/// group, a window and a menu. Measured on a live desktop: an `AXColumn` whose
/// `AXChildren` was empty carried 27 rows in `AXRows`, i.e. a whole table column
/// was invisible to the model without this fallback.
///
/// `AXVisibleChildren` is deliberately NOT a candidate: Apple documents it as a
/// subset of `AXChildren` ("a subset of the element's kAXChildrenAttribute that a
/// sighted user can see"), so using it would only ever *hide* content we can
/// already read. `AXContents` is a subset as well ("the contents of a scroll area
/// are the children that get scrolled... a tab group does not include the tabs"),
/// and a live probe found zero containers where it was populated but
/// `AXChildren` was empty — so it is not worth an extra round trip.
public enum NativeAXChildSources {
  public static let primaryAttribute = "AXChildren"
  public static let rowsAttribute = "AXRows"

  /// Roles whose content is documented to live in `AXRows`.
  public static let rowBearingRoles: Set<String> = [
    "AXTable", "AXOutline", "AXList", "AXColumn", "AXRow", "AXBrowser", "AXGrid",
  ]

  /// Attribute names to try, in order. The first one that yields at least one
  /// child wins, so a container that reports children normally never pays for
  /// the fallback.
  public static func candidates(forRole role: String) -> [String] {
    guard rowBearingRoles.contains(role) else { return [primaryAttribute] }
    return [primaryAttribute, rowsAttribute]
  }
}
