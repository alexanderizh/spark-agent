import Foundation

/// Renders the flat pre-order AX element list into the hierarchical Markdown
/// outline the decision model actually reads. This replaces the previous flat
/// JSON dump (unreadable hierarchy, huge token cost) with the format the Codex
/// computer-use service uses: one line per element, two-space indentation per
/// depth level, inline name/value text, and a short bracketed element id that
/// decision tools reference back:
///
/// ```text
/// - window "Settings" [1]
///   - group "Sidebar" [2]
///     - button "General" [3]
///     - button "Network" [4]
///   - textField "Search" = "vpn" [focused] [5]
///   - checkBox "Connect automatically" [checked] [6]
/// ```
///
/// Design rules (matching the reverse-engineered Codex renderer):
///  - Element ids are dense line indexes ("1", "2", ...), stable for the tree
///    version they were rendered in. The model always acts on the freshest
///    tree, so cross-frame id stability is unnecessary while short ids keep
///    the outline compact and cheap to reference.
///  - Invisible leaf noise (unnamed, valueless, non-actionable leaves) is
///    dropped; containers are kept because they carry the hierarchy.
///  - Line-level budgets (name/value length, total text) bound the payload so
///    a huge tree degrades into a truncation marker instead of a prompt bomb.
public enum NativeAXTreeRenderer {
  public struct RenderedLine: Equatable, Sendable {
    public let elementID: String
    public let text: String
    public let runtimeID: String

    init(elementID: String, text: String, runtimeID: String) {
      self.elementID = elementID
      self.text = text
      self.runtimeID = runtimeID
    }
  }

  public struct RenderedTree: Equatable, Sendable {
    public let lines: [RenderedLine]
    public let text: String
    public let omittedCount: Int

    init(lines: [RenderedLine], text: String, omittedCount: Int) {
      self.lines = lines
      self.text = text
      self.omittedCount = omittedCount
    }
  }

  /// Per-line budgets in UTF-16 units.
  public static let maxNameUTF16 = 160
  public static let maxValueUTF16 = 240
  /// Total rendered-text budget. Comfortably below the 2 MB wire cap and the
  /// 32k-char decision-prompt budget so the TS side never re-truncates a
  /// well-formed tree.
  public static let maxTotalUTF16 = 90_000
  /// Containers report all children but the collector only recurses into the
  /// first `maxChildrenPerContainer`; the renderer notes the truncation so the
  /// model knows a long list was cut (matching Codex's "N of M items" line).
  public static let maxChildrenPerContainer = 120
  private static let maxIndentDepth = 24

  public static func render(_ elements: [NativeAXRawElement]) -> RenderedTree {
    var lines: [RenderedLine] = []
    var textSegments: [String] = []
    var textUnits = 0
    var omitted = 0
    var budgetExhausted = false

    for (index, element) in elements.enumerated() {
      let isLeaf = index + 1 >= elements.count
        || elements[index + 1].depth <= element.depth
      if isNoise(element, isLeaf: isLeaf) {
        omitted += 1
        continue
      }
      if budgetExhausted {
        omitted += 1
        continue
      }
      let elementID = "\(lines.count + 1)"
      let line = renderLine(element, elementID: elementID)
      let lineUnits = line.utf16.count
      let separatorUnits = textSegments.isEmpty ? 0 : 1
      // Exact budget including the "\n" separators of the joined text: a line
      // that would cross the cap is dropped, not clipped mid-way, so the final
      // text never exceeds the cap plus the truncation marker.
      if textUnits + separatorUnits + lineUnits > maxTotalUTF16 {
        budgetExhausted = true
        omitted += 1
        continue
      }
      lines.append(
        RenderedLine(elementID: elementID, text: line, runtimeID: element.runtimeID))
      textSegments.append(line)
      textUnits += separatorUnits + lineUnits
    }

    var text = textSegments.joined(separator: "\n")
    if budgetExhausted {
      let marker = "[truncated: \(omitted) elements omitted]"
      text += text.isEmpty ? marker : "\n" + marker
    }
    return RenderedTree(lines: lines, text: text, omittedCount: omitted)
  }

  /// Leaf elements that carry no information the model can act on: no name,
  /// no value, no actions, not focused. Dropping them routinely removes more
  /// than half of a real AX tree (layout padders, empty groups, image shells).
  private static func isNoise(_ element: NativeAXRawElement, isLeaf: Bool) -> Bool {
    guard isLeaf else { return false }
    let emptyName = element.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let emptyValue = (element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    return emptyName && emptyValue && element.actions.isEmpty && !element.focused
  }

  private static func renderLine(_ element: NativeAXRawElement, elementID: String) -> String {
    let indent = String(repeating: "  ", count: min(element.depth, maxIndentDepth))
    var parts: [String] = ["- \(roleWord(element))"]
    let name = inline(element.name, limit: maxNameUTF16)
    if !name.isEmpty {
      parts.append("\"\(name)\"")
    }
    let marker = stateMarker(element)
    if let marker {
      parts.append(marker)
    }
    let value = inline(element.value ?? "", limit: maxValueUTF16)
    // When the state marker already expresses the value (checked/unchecked),
    // repeating the raw "1"/"0" only adds noise.
    if marker == nil, !value.isEmpty {
      parts.append("= \"\(value)\"")
    } else if marker == nil, value.isEmpty, let placeholder = element.placeholder,
      !placeholder.isEmpty
    {
      parts.append("placeholder=\"\(inline(placeholder, limit: maxNameUTF16))\"")
    }
    if element.selected {
      parts.append("[selected]")
    }
    if !element.enabled {
      parts.append("[disabled]")
    }
    if element.focused {
      parts.append("[focused]")
    }
    if element.childCount > maxChildrenPerContainer {
      parts.append("(\(element.childCount) items, first \(maxChildrenPerContainer) shown)")
    }
    parts.append("[\(elementID)]")
    return indent + parts.joined(separator: " ")
  }

  /// Prefer the app's own human wording (AXRoleDescription, e.g. "push
  /// button") over the raw AXRole; fall back to the camel-cased role.
  private static func roleWord(_ element: NativeAXRawElement) -> String {
    if let described = element.roleDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
      !described.isEmpty
    {
      return inline(described, limit: 60)
    }
    return displayRole(element.role)
  }

  /// Checkbox/switch/radio controls expose 0/1 values that read terribly as
  /// text; render them as explicit state markers instead.
  private static func stateMarker(_ element: NativeAXRawElement) -> String? {
    let value = (element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    switch element.role {
    case "AXCheckBox", "AXRadioButton", "AXSwitch":
      if value == "1" || value.lowercased() == "true" || value.lowercased() == "on" {
        return "[checked]"
      }
      if value == "0" || value.lowercased() == "false" || value.lowercased() == "off" {
        return "[unchecked]"
      }
      return nil
    default:
      return nil
    }
  }

  /// "AXTextField" → "textField"; "group" → "group".
  private static func displayRole(_ role: String) -> String {
    var value = role
    if value.hasPrefix("AX") && value.count > 2 {
      value.removeFirst(2)
    }
    guard let first = value.first else { return "unknown" }
    return String(first.lowercased() + value.dropFirst())
  }

  /// Collapse a value into a single prompt-friendly line: strip control
  /// characters, fold runs of whitespace, bound the length.
  private static func inline(_ value: String, limit: Int) -> String {
    var folded = String()
    folded.reserveCapacity(min(value.count, limit))
    var units = 0
    var pendingSpace = false
    for character in value {
      if character == "\n" || character == "\r" || character == "\t" || character == " " {
        pendingSpace = !folded.isEmpty
        continue
      }
      if character.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) {
        continue
      }
      if pendingSpace {
        let space = " "
        if units + space.utf16.count > limit { break }
        folded.append(space)
        units += space.utf16.count
        pendingSpace = false
      }
      let count = String(character).utf16.count
      if units + count > limit { break }
      folded.append(character)
      units += count
      if units >= limit { break }
    }
    return folded
  }
}
