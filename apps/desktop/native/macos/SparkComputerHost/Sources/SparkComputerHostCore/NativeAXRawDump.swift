import Foundation

/// Diagnostic dump of the raw, pre-order AX element list.
///
/// The published snapshot only contains the elements that survived folding
/// (`NativeAXElementRef`: id, role, name, value, bounds, enabled, focused,
/// actions) — it has no depth and none of the placement attributes, which makes
/// it impossible to reason about *why* a node was kept or folded. Tree-quality
/// work needs the input side of the renderer: depth, role, role description,
/// value, action set and geometry.
///
/// Enabled in development with `SPARK_CU_DUMP_AX_RAW=<path>`; the file is meant
/// to be analysed with a script, not read by a human:
///
/// ```text
/// depth  role      subrole            roleDescription  name      value  actions  flags    bounds
/// 0      AXWindow  AXStandardWindow   standard window  Workbench        focus    focused  x,y,w,h
/// 1      AXGroup   AXLandmarkNavigation  navigation                       scroll
/// ```
public enum NativeAXRawDump {
  public static let header =
    "depth\trole\tsubrole\troleDescription\tname\tvalue\tactions\tflags\tbounds"

  public static func render(_ elements: [NativeAXRawElement]) -> String {
    var lines: [String] = [header]
    lines.reserveCapacity(elements.count + 1)
    for element in elements {
      var flags: [String] = []
      if element.focused { flags.append("focused") }
      if element.selected { flags.append("selected") }
      if !element.enabled { flags.append("disabled") }
      if element.secure { flags.append("secure") }
      if element.placeholder != nil { flags.append("placeholder") }
      if element.childCount > 0 { flags.append("children=\(element.childCount)") }
      lines.append(
        [
          String(element.depth),
          field(element.role),
          field(element.subrole),
          field(element.roleDescription ?? ""),
          field(element.name),
          field(element.value ?? ""),
          field(element.actions.joined(separator: ",")),
          field(flags.joined(separator: ",")),
          "\(element.bounds.x),\(element.bounds.y),\(element.bounds.width),\(element.bounds.height)",
        ].joined(separator: "\t"))
    }
    return lines.joined(separator: "\n") + "\n"
  }

  /// Tabs and newlines would break the one-line-per-element contract.
  static func field(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\t", with: " ")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\r", with: "\\r")
  }
}
