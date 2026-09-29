import Foundation

/// Structural clean-up of the flat pre-order AX list before it is rendered.
///
/// Real trees carry a lot of pure structure: Chromium nests web content behind
/// chains of non-descriptive `AXGroup`s (measured: seven levels of empty groups
/// before the browser chrome, and another seven where the page content lives),
/// AppKit wraps list content in `AXRow` → `AXCell` → text, and Finder's desktop
/// icons are named `AXGroup`s whose only child is a named `AXImage`. Rendering
/// that verbatim costs indentation, tokens and clarity without adding a single
/// fact the model can act on.
///
/// Three rules, each backed by observed data:
///
///  - **Flatten** a node that has exactly one surviving child and nothing of its
///    own to say (no name, no value, no placeholder, not focused, not selected,
///    and no `invoke` capability). "Nothing of its own" deliberately ignores the
///    other capabilities: Chromium reports `AXValue`/`AXSelectedTextRange` as
///    settable on plain layout groups, so treating those as content would keep
///    every wrapper in the outline.
///  - **Adopt a label**: a container whose name is empty takes the name of its
///    first label-only child (a leaf that is neither focusable nor pressable),
///    and that child is folded away. This is ARIA's "name from content": without
///    it the actionable element is the *unnamed* parent and the text sits in a
///    child that cannot be activated.
///  - **Prune decoration**: `AXValueIndicator` is a drawing artifact of sliders
///    and scrollbars, the arrow/page buttons inside an `AXScrollBar` are never
///    worth a decision (measured: 5 such lines per scrollbar), and a list marker
///    that only spells a bullet ("•") is drawn chrome rather than content.
///  - **Promote through layout boxes** (rule 5): a nameless, valueless container
///    whose role is pure layout (`AXGroup`, `AXUnknown`, ...) is a box, not a
///    fact — its children move up one level instead of the outline spending a
///    line and an indent step on it. Measured on the packaged SparkWork:
///    197 nameless `AXGroup`s; on WorkBuddy: 233. Landmark roles (`AXDialog`,
///    `AXSheet`, `AXScrollArea`, `AXTable`, `AXRow`, `AXCell`, `AXList`,
///    `AXTabGroup`, ...) are never promoted: they still tell the model how the
///    interface is organised.
///  - **Drop shadowed press wrappers** (rule 6): a nameless pressable container
///    whose only surviving child is pressable over the exact same rectangle
///    (measured: `AXGroup` 155x27 around `AXButton "环境信息"`, and Chromium's
///    identical 1449x935 web-content pairs). The child IS the control, so the
///    wrapper only makes the model pick between two names for one rectangle.
///
/// Effective depth is recomputed from the surviving parent chain rather than
/// patched numerically, so a promoted child can never end up mis-indented.
public enum NativeAXTreeStructure {
  /// Capabilities that justify keeping a nameless, valueless element in the
  /// outline.
  ///
  /// `focus`/`select`/`set_value` are absent: they are settability probes, and
  /// Chromium answers them positively for plain layout groups (measured:
  /// `AXGroup`, no name, `actions=[focus, select, set_value]`).
  ///
  /// `scroll` is absent for the same reason, with harder evidence: measured on
  /// two Electron apps, 847/850 (SparkWork) and 843/847 (WorkBuddy) elements
  /// claim `scroll` — including `AXImage`, `AXStaticText`, `AXRow` and `AXCell`,
  /// which obviously cannot scroll. Because the claim is generic, counting it
  /// kept 336 of 850 rendered lines alive in SparkWork (197 nameless `AXGroup`s
  /// plus 100 nameless `AXImage`s) and blocked both single-child folding and
  /// void-subtree elimination. Real scroll containers are recognised by ROLE
  /// instead — see `scrollContainerRoles`.
  ///
  /// `invoke` stays: only ~140 of 850 elements claim `AXPress`, and they are the
  /// ones the model can genuinely click.
  public static let outlineRelevantCapabilities: Set<String> = ["invoke"]

  /// Roles that are an interaction target even when they are nameless and
  /// valueless: a scroll container carries no text, but it is the thing the
  /// model scrolls (`performBackgroundScroll` performs AXIncrement/AXDecrement
  /// on the given element). The role is a precise signal; the `scroll`
  /// capability is not (see above).
  public static let scrollContainerRoles: Set<String> = ["AXScrollArea"]

  /// Subroles that earn a nameless container its own line.
  ///
  /// `AXSubrole` is a stable token, unlike the localized `AXRoleDescription`
  /// prose, and Chromium publishes ARIA semantics through it. Measured on the
  /// packaged SparkWork: `AXLandmarkRegion` x6, `AXLandmarkNavigation`,
  /// `AXApplicationStatus`, `AXUserInterfaceTooltip` — these say WHERE in the
  /// interface the model is, which no child line can express.
  ///
  /// Inline styling groups are deliberately absent: `AXCodeStyleGroup` (77) and
  /// `AXStrongStyleGroup` (49) annotate a text span, they do not describe a
  /// region, and the text itself survives as the promoted child.
  public static let outlineRelevantSubroles: Set<String> = [
    "AXLandmarkRegion", "AXLandmarkNavigation", "AXLandmarkMain", "AXLandmarkBanner",
    "AXLandmarkContentInfo", "AXLandmarkComplementary", "AXLandmarkSearch",
    "AXApplicationStatus", "AXApplicationAlert", "AXUserInterfaceTooltip",
  ]

  /// Roles that are pure layout boxes: a nameless one of these is promoted away
  /// by rule 5. Deliberately excludes every structural/landmark role
  /// (`AXDialog`, `AXSheet`, `AXScrollArea`, `AXTable`, `AXRow`, `AXCell`,
  /// `AXList`, `AXColumn`, `AXTabGroup`, `AXToolbar`, `AXWebArea`, ...).
  public static let transparentContainerRoles: Set<String> = [
    "AXGroup", "AXUnknown", "AXGenericElement", "AXLayoutArea", "AXLayoutItem",
  ]

  /// Roles whose text is the readable label of the thing around it, best first:
  /// used to pick which child names a container when several children could.
  public static let textRoles: Set<String> = [
    "AXStaticText", "AXHeading", "AXLink", "AXTextField", "AXTextArea",
  ]

  /// Roles a container may take its name FROM. Text spans and icons describe the
  /// thing around them; structural children do not — naming a row after its
  /// first `AXCell` (or a list item after its nested `AXList`) would erase the
  /// role of a node the model has to navigate. Measured: a nameless `AXTable`
  /// row whose cells are "名称"/"大小" must stay a row with two cells.
  public static let adoptableLabelRoles: Set<String> =
    textRoles.union(["AXImage", "AXListMarker"])

  /// Roles that commonly carry their label in a child rather than in their own
  /// name (ARIA calls this "name from content": cell, row, button, tab, ...).
  public static let labelBearingRoles: Set<String> = [
    "AXCell", "AXRow", "AXButton", "AXMenuItem", "AXLink", "AXTab", "AXRadioButton",
    "AXCheckBox", "AXListItem", "AXColumn", "AXHeading", "AXMenuItemMarker",
  ]

  public struct Node: Equatable, Sendable {
    public let element: NativeAXRawElement
    /// Indentation level after flattening (0 = window).
    public let depth: Int
    /// Surviving direct children, used for the "N items" truncation note.
    public let childCount: Int
  }

  public struct Tree: Equatable, Sendable {
    public let nodes: [Node]
    /// Elements dropped because they carried no usable information.
    public let prunedCount: Int
  }

  public static func analyze(_ elements: [NativeAXRawElement]) -> Tree {
    guard !elements.isEmpty else { return Tree(nodes: [], prunedCount: 0) }

    let parentOf = parentIndexes(elements)
    let childIndexes = childIndexes(elements, parentOf: parentOf)
    let pruned = prunedFlags(elements, parentOf: parentOf, childIndexes: childIndexes)

    // Flattening (rule 1) and label adoption (rule 2) both remove nodes. They
    // are resolved in rounds because a single round can expose a new
    // single-child wrapper further up the chain.
    var removed = pruned
    var adoptedNames = [String?](repeating: nil, count: elements.count)

    var pending = true
    var rounds = 0
    while pending, rounds < 8 {
      pending = false
      rounds += 1
      let survivingChildren = effectiveChildren(
        elements, parentOf: parentOf, childIndexes: childIndexes, removed: removed)
      for index in elements.indices where !removed[index] {
        let element = elements[index]
        let children = survivingChildren[index]
        let ownName = adoptedNames[index] ?? element.name

        // Rule 2 first: a labelled child can name its container.
        if ownName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          (element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
          // Two shapes take their name from content: the ARIA roles documented to
          // carry their label in a child (cell, row, button, tab, ...) — a plain
          // container with a single labelled child is instead handled by rule 1,
          // which promotes the label rather than renaming the container — and any
          // nameless container that is pressable. Measured on the packaged
          // SparkWork: the session list rows are nameless `AXGroup`s with
          // `invoke` whose only child is the title text, so without this the
          // model sees "组 [58]" and cannot tell one session from another.
          labelBearingRoles.contains(element.role)
            || element.actions.contains(where: { outlineRelevantCapabilities.contains($0) }),
          let label = labelChild(
            of: element, children: children, elements: elements,
            survivingChildren: survivingChildren),
          let text = labelText(elements[label])
        {
          adoptedNames[index] = text
          removed[label] = true
          pending = true
          continue
        }

        // Rule 1: a wrapper with a single child and nothing of its own.
        if element.depth > 0, children.count == 1,
          isPureWrapper(element, name: ownName)
            || isShadowedPressWrapper(element, child: elements[children[0]])
        {
          removed[index] = true
          pending = true
          continue
        }

        // Rule 5: a nameless layout box with several children. Nothing is lost —
        // every child survives, one indent step shallower — while a third of the
        // outline (measured: 197 of 850 lines in SparkWork, 233 of 847 in
        // WorkBuddy) stops being spent on boxes that say nothing.
        if element.depth > 0, children.count > 1,
          transparentContainerRoles.contains(element.role),
          isPureWrapper(element, name: ownName)
        {
          removed[index] = true
          pending = true
        }
      }
    }

    // Rule 4 (void elimination): drop subtrees that offer nothing at all —
    // no name, no value, no outline-relevant capability anywhere inside. This
    // replaces the older "unnamed valueless leaf" test, which could not remove a
    // wrapper whose children had all been dropped themselves (the empty-group
    // chains Chromium emits around web content).
    var voidChildren = effectiveChildren(
      elements, parentOf: parentOf, childIndexes: childIndexes, removed: removed)
    var isVoid = [Bool](repeating: false, count: elements.count)
    for index in elements.indices.reversed() where !removed[index] {
      let children = voidChildren[index].filter { !removed[$0] }
      let own = hasOutlineValue(elements[index], name: adoptedNames[index] ?? elements[index].name)
      isVoid[index] = !own && children.allSatisfy { isVoid[$0] }
      if isVoid[index], elements[index].depth > 0 {
        removed[index] = true
      } else {
        isVoid[index] = false
      }
    }

    let survivingChildren = effectiveChildren(
      elements, parentOf: parentOf, childIndexes: childIndexes, removed: removed)

    var nodes: [Node] = []
    nodes.reserveCapacity(elements.count)
    var depthByIndex = [Int?](repeating: nil, count: elements.count)
    for index in elements.indices where !removed[index] {
      let parent = parentOf[index]
      let depth: Int
      if let parent, !removed[parent], let parentDepth = depthByIndex[parent] {
        depth = parentDepth + 1
      } else {
        // Nearest surviving ancestor (or the root).
        var ancestor = parent
        var resolved = 0
        while let candidate = ancestor {
          if !removed[candidate], let ancestorDepth = depthByIndex[candidate] {
            resolved = ancestorDepth + 1
            break
          }
          ancestor = parentOf[candidate]
        }
        depth = resolved
      }
      depthByIndex[index] = depth
      let element = elements[index]
      let name = adoptedNames[index]
      nodes.append(
        Node(
          element: name.map { element.replacingName($0) } ?? element,
          depth: depth,
          childCount: survivingChildren[index].count))
    }

    let prunedCount = elements.indices.filter { removed[$0] && !pruned[$0] }.count + pruned.filter { $0 }.count
    return Tree(nodes: nodes, prunedCount: prunedCount)
  }

  // MARK: - classification

  /// Elements that are pure decoration in the rendered outline: slider and
  /// scrollbar value indicators, and list markers that only draw a bullet.
  static func isDecoration(_ element: NativeAXRawElement) -> Bool {
    if element.role == "AXValueIndicator" { return true }
    if element.role == "AXListMarker" { return !isMeaningfulMarker(element) }
    return false
  }

  /// A list marker is decoration unless it spells something: measured, 30 of
  /// them in WorkBuddy all carrying "•", but an ordered list carries its item
  /// number ("1.") and that is content the model can use to count items.
  static func isMeaningfulMarker(_ element: NativeAXRawElement) -> Bool {
    let text = element.name + (element.value ?? "")
    return text.contains { $0.isLetter || $0.isNumber }
  }

  /// A nameless container whose only surviving child is pressable over exactly
  /// the same rectangle: pressing either presses the same pixels, so the wrapper
  /// is a second name for one control. Both sides must be pressable — otherwise
  /// folding would drop the only press target (e.g. a clickable wrapper around a
  /// decorative image).
  static func isShadowedPressWrapper(
    _ element: NativeAXRawElement, child: NativeAXRawElement
  ) -> Bool {
    let name = element.name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard name.isEmpty, !element.focused, !element.selected else { return false }
    guard !hasSemanticSubrole(element), !scrollContainerRoles.contains(element.role) else {
      return false
    }
    guard element.actions.contains("invoke"), child.actions.contains("invoke") else { return false }
    return sameBounds(element.bounds, child.bounds)
  }

  /// Bounds equality within a point: web layouts report sub-pixel differences
  /// for boxes that are meant to be the same rectangle.
  static func sameBounds(_ lhs: NativeRect, _ rhs: NativeRect, tolerance: Double = 1) -> Bool {
    abs(lhs.x - rhs.x) <= tolerance && abs(lhs.y - rhs.y) <= tolerance
      && abs(lhs.width - rhs.width) <= tolerance && abs(lhs.height - rhs.height) <= tolerance
  }

  /// The child whose text should name a container: the first label-only TEXT
  /// child when there is one (a session row's title beats its status chip), else
  /// the first label-only child the container may take a name from at all.
  ///
  /// `element` is the container: the distinction matters because a row is
  /// labelled by its text or icon, never by another structural child.
  static func labelChild(
    of element: NativeAXRawElement, children: [Int], elements: [NativeAXRawElement],
    survivingChildren: [[Int]]
  ) -> Int? {
    let labels = children.filter {
      isLabelOnly(elements[$0], children: survivingChildren[$0])
        && adoptableLabelRoles.contains(elements[$0].role)
    }
    return labels.first { textRoles.contains(elements[$0].role) } ?? labels.first
  }

  /// `AXScrollBar` children are the arrow/page buttons and the thumb indicator:
  /// the scrollbar itself already carries the scroll capability.
  static func isScrollBarInternal(role: String, parentRole: String?) -> Bool {
    parentRole == "AXScrollBar" && role != "AXScrollBar"
  }

  /// True when the element itself says something the model can use: a name, a
  /// value, a placeholder, focus, selection state, or a real action.
  static func hasOutlineValue(_ element: NativeAXRawElement, name: String) -> Bool {
    let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedValue = (element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedPlaceholder = (element.placeholder ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !trimmedName.isEmpty || !trimmedValue.isEmpty || !trimmedPlaceholder.isEmpty {
      return true
    }
    if element.focused || element.selected { return true }
    if scrollContainerRoles.contains(element.role) { return true }
    if hasSemanticSubrole(element) { return true }
    return element.actions.contains { outlineRelevantCapabilities.contains($0) }
  }

  /// Whether the app told us, in a stable token, that this element is more than
  /// a layout box (a landmark region, a tooltip, a live status region, ...).
  static func hasSemanticSubrole(_ element: NativeAXRawElement) -> Bool {
    outlineRelevantSubroles.contains(element.subrole)
  }

  /// A node with nothing of its own to contribute to the outline.
  static func isPureWrapper(_ element: NativeAXRawElement, name: String) -> Bool {
    !hasOutlineValue(element, name: name)
  }

  /// A leaf that exists only to spell out text for its container: it has text
  /// (in its name or its value — for a `AXStaticText` the text IS the value) and
  /// carries no behaviour of its own.
  static func isLabelOnly(_ element: NativeAXRawElement, children: [Int]) -> Bool {
    guard children.isEmpty, !element.focused, !element.selected else { return false }
    guard !element.actions.contains(where: { outlineRelevantCapabilities.contains($0) }) else {
      return false
    }
    return labelText(element) != nil
  }

  static func labelText(_ element: NativeAXRawElement) -> String? {
    let name = element.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty { return element.name }
    let value = (element.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !value.isEmpty { return element.value }
    return nil
  }

  // MARK: - structure helpers

  static func parentIndexes(_ elements: [NativeAXRawElement]) -> [Int?] {
    var parentOf = [Int?](repeating: nil, count: elements.count)
    var stack: [Int] = []
    for index in elements.indices {
      while let last = stack.last, elements[last].depth >= elements[index].depth {
        stack.removeLast()
      }
      parentOf[index] = stack.last
      stack.append(index)
    }
    return parentOf
  }

  /// Direct children per index, keeping the raw (all-elements) adjacency so the
  /// caller can recompute survivors cheaply as nodes are removed.
  static func childIndexes(
    _ elements: [NativeAXRawElement], parentOf: [Int?]
  ) -> [[Int]] {
    var children = [[Int]](repeating: [], count: elements.count)
    for index in elements.indices {
      if let parent = parentOf[index] { children[parent].append(index) }
    }
    return children
  }

  static func prunedFlags(
    _ elements: [NativeAXRawElement], parentOf: [Int?], childIndexes: [[Int]]
  ) -> [Bool] {
    var pruned = [Bool](repeating: false, count: elements.count)
    for index in elements.indices {
      let element = elements[index]
      let parentRole = parentOf[index].map { elements[$0].role }
      if isDecoration(element)
        || isScrollBarInternal(role: element.role, parentRole: parentRole)
      {
        markSubtree(index, childIndexes: childIndexes, pruned: &pruned)
      }
    }
    return pruned
  }

  private static func markSubtree(_ index: Int, childIndexes: [[Int]], pruned: inout [Bool]) {
    if pruned[index] { return }
    pruned[index] = true
    for child in childIndexes[index] {
      markSubtree(child, childIndexes: childIndexes, pruned: &pruned)
    }
  }

  /// Direct children of each surviving node, with removed subtrees collapsed
  /// into their nearest surviving ancestor.
  static func effectiveChildren(
    _ elements: [NativeAXRawElement], parentOf: [Int?], childIndexes: [[Int]], removed: [Bool]
  ) -> [[Int]] {
    var result = [[Int]](repeating: [], count: elements.count)
    for index in elements.indices where !removed[index] {
      var ancestor = parentOf[index]
      while let candidate = ancestor, removed[candidate] {
        ancestor = parentOf[candidate]
      }
      if let ancestor { result[ancestor].append(index) }
    }
    return result
  }
}

extension NativeAXRawElement {
  /// Same element with a different focus flag (used by the true-focus pass).
  public func replacingFocused(_ focused: Bool) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID, role: role, subrole: subrole, name: name, value: value, bounds: bounds,
      enabled: enabled, focused: focused, actions: actions, secure: secure, depth: depth,
      roleDescription: roleDescription, placeholder: placeholder, selected: selected,
      childCount: childCount)
  }

  /// Same element with a different rendered name (used by label adoption).
  public func replacingName(_ name: String) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID, role: role, subrole: subrole, name: name, value: value, bounds: bounds,
      enabled: enabled, focused: focused, actions: actions, secure: secure, depth: depth,
      roleDescription: roleDescription, placeholder: placeholder, selected: selected,
      childCount: childCount)
  }
}
