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
///  - Pure structure is folded away first (`NativeAXTreeStructure`): single-child
///    wrappers collapse, a nameless container adopts the label of its label-only
///    child, decoration (scrollbar internals, value indicators) is pruned, and
///    subtrees that offer nothing at all are dropped.
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

  /// Marker for an outline cut by the text budget.
  ///
  /// The cut is positional (document order), and document order runs down the
  /// window: measured on the packaged SparkWork, a long conversation produced
  /// 1822 elements, the outline stopped at 1019 lines with 804 omitted, and the
  /// message input (`AXTextArea`, raw index 1752 of 1822) never appeared — the
  /// model could not see the one control the whole task needed, and nothing in
  /// the tree said why. The marker therefore states what is missing and the
  /// recovery that actually works: the screenshot is delivered in full, so a
  /// control the outline dropped is still addressable by coordinate.
  public static func budgetMarker(omitted: Int) -> String {
    "[truncated: \(omitted) elements omitted — the outline stops part-way down this window, "
      + "so controls near its bottom may be missing; the screenshot is complete, "
      + "address a missing control by coordinate]"
  }

  /// Marker appended when the *traversal* stopped at the element limit, as
  /// opposed to `[truncated: N elements omitted]`, which says the rendered text
  /// hit its own budget. Both are silent cuts of the model's view of a window,
  /// but they need different recoveries: a text-budget cut is still the same
  /// interface, while a traversal cut means part of the window was never read —
  /// measured on the packaged SparkWork, whose window produced exactly 2000
  /// elements (the cap) with no marker at all, so the tree simply appeared to end.
  public static func traversalLimitNotice(limit: Int) -> String {
    "[truncated: this window has more than \(limit) elements — only the first \(limit) were read; "
      + "scroll its own container and observe again to reach the rest]"
  }

  /// Per-line budgets in UTF-16 units.
  public static let maxNameUTF16 = 160
  public static let maxValueUTF16 = 240
  /// Total rendered-text budget. MUST stay at or below the TS-side
  /// `MAX_TREE_PROMPT_CHARS` (ComputerDecisionAdapter): a larger budget here
  /// made the decision path slice the tree mid-way and discard the trailing
  /// `[n]` element ids, while the atomic path shipped up to 90k chars per
  /// tool response. Both sides now share one 48k budget — the renderer
  /// guarantees a well-formed tree never needs re-truncation.
  public static let maxTotalUTF16 = 48_000
  /// Containers report all children but the collector only recurses into the
  /// first `maxChildrenPerContainer`; the renderer notes the truncation so the
  /// model knows a long list was cut (matching Codex's "N of M items" line).
  public static let maxChildrenPerContainer = 120
  private static let maxIndentDepth = 24

  public static func render(_ elements: [NativeAXRawElement]) -> RenderedTree {
    let structure = NativeAXTreeStructure.analyze(elements)
    let nodes = structure.nodes
    var lines: [RenderedLine] = []
    var textSegments: [String] = []
    var textUnits = 0
    var omitted = structure.prunedCount
    var budgetExhausted = false

    for (index, node) in nodes.enumerated() {
      let isLeaf = index + 1 >= nodes.count || nodes[index + 1].depth <= node.depth
      if isLeaf, !NativeAXTreeStructure.hasOutlineValue(node.element, name: node.element.name) {
        omitted += 1
        continue
      }
      if budgetExhausted {
        omitted += 1
        continue
      }
      let elementID = "\(lines.count + 1)"
      let line = renderLine(node, elementID: elementID)
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
        RenderedLine(elementID: elementID, text: line, runtimeID: node.element.runtimeID))
      textSegments.append(line)
      textUnits += separatorUnits + lineUnits
    }

    var text = textSegments.joined(separator: "\n")
    if budgetExhausted {
      let marker = NativeAXTreeRenderer.budgetMarker(omitted: omitted)
      text += text.isEmpty ? marker : "\n" + marker
    }
    return RenderedTree(lines: lines, text: text, omittedCount: omitted)
  }

  private static func renderLine(_ node: NativeAXTreeStructure.Node, elementID: String) -> String {
    let element = node.element
    let indent = String(repeating: "  ", count: min(node.depth, maxIndentDepth))
    var parts: [String] = ["- \(roleWord(element))"]
    let name = inline(shortenedURL(element.name), limit: maxNameUTF16)
    if !name.isEmpty {
      parts.append("\"\(name)\"")
    }
    let marker = stateMarker(element)
    if let marker {
      parts.append(marker)
    }
    let value = inline(shortenedURL(element.value ?? ""), limit: maxValueUTF16)
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
    // Report the largest child count we know: the app's raw list may be longer
    // than what survived flattening, and the note must never understate it.
    let declaredChildren = max(element.childCount, node.childCount)
    if declaredChildren > maxChildrenPerContainer {
      parts.append("(\(declaredChildren) items, first \(maxChildrenPerContainer) shown)")
    }
    parts.append("[\(elementID)]")
    return indent + parts.joined(separator: " ")
  }

  /// Long URLs are decision noise: the model needs the origin and the tail to
  /// recognize a link, not a 200-character query string (Codex shortens URLs
  /// in rendered output too). Non-URL text passes through untouched.
  static func shortenedURL(_ text: String, maxTotalUTF16: Int = 48, tailUTF16: Int = 12)
    -> String
  {
    guard text.utf16.count > maxTotalUTF16 else { return text }
    guard let origin = text.range(of: #"^https?://[^/\s]+"#, options: .regularExpression)
    else { return text }
    let tail = String(text.suffix(tailUTF16))
    return "\(text[origin])/…\(tail)"
  }

  /// Prefer the app's own human wording (AXRoleDescription, e.g. "push
  /// button") over the raw AXRole; fall back to the camel-cased role.
  ///
  /// Some apps echo the raw role as its own description (measured: Chromium
  /// reports `AXListMarker` as the role description of a list marker), which
  /// would leak the API token into the model-facing outline — those fall back to
  /// the camel-cased role word like any element without a description.
  private static func roleWord(_ element: NativeAXRawElement) -> String {
    if let described = element.roleDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
      !described.isEmpty, described != element.role
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
