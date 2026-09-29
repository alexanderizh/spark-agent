import XCTest

@testable import SparkComputerHostCore

final class NativeAXTreeRendererTests: XCTestCase {
  func testRendersHierarchicalOutlineWithInlineIdsAndValues() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Settings", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "g", role: "AXGroup", name: "Sidebar", value: nil, depth: 1, actions: []),
        raw(runtimeID: "b1", role: "AXButton", name: "General", value: nil, depth: 2,
          actions: ["invoke"]),
        raw(runtimeID: "b2", role: "AXButton", name: "Network", value: nil, depth: 2,
          actions: ["invoke"]),
        raw(runtimeID: "t", role: "AXTextField", name: "Search", value: "vpn", depth: 1,
          actions: ["set_value"], focused: true),
      ])

    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Settings\" [1]",
        "  - group \"Sidebar\" [2]",
        "    - button \"General\" [3]",
        "    - button \"Network\" [4]",
        "  - textField \"Search\" = \"vpn\" [focused] [5]",
      ])
    XCTAssertEqual(tree.lines.map(\.elementID), ["1", "2", "3", "4", "5"])
    XCTAssertEqual(tree.lines.map(\.runtimeID), ["w", "g", "b1", "b2", "t"])
    XCTAssertEqual(tree.omittedCount, 0)
  }

  func testFoldsUnnamedWrappersWithoutLosingTheSubtreeText() {
    // Measured shapes: a layout group with no name/actions (Chromium emits a
    // chain of these around web content) and an unnamed AXList wrapping a single
    // labelled row. Both carry no information of their own, so they collapse and
    // the text is promoted instead of hanging three levels deep.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "pad", role: "AXGroup", name: "", value: nil, depth: 1, actions: []),
        raw(runtimeID: "list", role: "AXList", name: "", value: nil, depth: 1, actions: []),
        raw(runtimeID: "item", role: "AXStaticText", name: "", value: "Row one", depth: 2,
          actions: []),
      ])

    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - staticText = \"Row one\" [2]",
      ])
    XCTAssertEqual(tree.omittedCount, 2)
  }

  func testPressableContainerTakesItsNameFromItsLabelChild() {
    // A pressable container that owns a label is not a wrapper to fold: the
    // label becomes its name, so the model can address the control by name
    // instead of seeing a bare "group" next to a text line it cannot press.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "wrap", role: "AXGroup", name: "", value: nil, depth: 1,
          actions: ["invoke"]),
        raw(runtimeID: "label", role: "AXStaticText", name: "", value: "Save", depth: 2,
          actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"Main\" [1]", "  - group \"Save\" [2]"])
    XCTAssertEqual(tree.lines.map(\.runtimeID), ["w", "wrap"])
  }

  func testPressableSessionRowPrefersItsTitleOverItsStatusBadge() {
    // Measured on the packaged SparkWork: a session row is a nameless pressable
    // AXGroup whose children are a status chip ("待推进") and the title text. The
    // name must come from the text child, otherwise every row would be named
    // after its badge.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "row", role: "AXGroup", name: "", value: nil, depth: 1,
          actions: ["invoke"]),
        raw(runtimeID: "chip", role: "AXGroup", name: "待推进", value: nil, depth: 2,
          actions: []),
        raw(runtimeID: "title", role: "AXStaticText", name: "", value: "语音唤醒Agent功能开发",
          depth: 2, actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - group \"语音唤醒Agent功能开发\" [2]",
        "    - group \"待推进\" [3]",
      ])
  }

  func testFoldsNamelessLayoutBoxesAndPromotesTheirChildren() {
    // Measured: a Chromium app spends 197 of 850 outline lines on nameless
    // AXGroups. A box that says nothing must not cost a line or an indent step.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "box", role: "AXGroup", name: "", value: nil, depth: 1, actions: []),
        raw(runtimeID: "box2", role: "AXGroup", name: "", value: nil, depth: 2, actions: []),
        raw(runtimeID: "a", role: "AXButton", name: "确定", value: nil, depth: 3,
          actions: ["invoke"]),
        raw(runtimeID: "b", role: "AXButton", name: "取消", value: nil, depth: 3,
          actions: ["invoke"]),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - button \"确定\" [2]",
        "  - button \"取消\" [3]",
      ])
    XCTAssertEqual(tree.omittedCount, 2)
  }

  func testFoldsTheChromiumScrollClaimInsteadOfPayingForIt() {
    // Measured: 847/850 elements in an Electron app claim `scroll`, including
    // nameless images and static text. That claim used to keep 336 of 850
    // rendered lines alive; it must not justify a line any more.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "App", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "g1", role: "AXGroup", name: "", value: nil, depth: 1, actions: ["scroll"]),
        raw(runtimeID: "g2", role: "AXGroup", name: "", value: nil, depth: 2, actions: ["scroll"]),
        raw(runtimeID: "img", role: "AXImage", name: "", value: nil, depth: 3, actions: ["scroll"]),
        raw(runtimeID: "round", role: "AXGroup", name: "", value: nil, depth: 3, actions: ["scroll"]),
        raw(runtimeID: "icon", role: "AXImage", name: "", value: nil, depth: 4, actions: ["scroll"]),
        raw(runtimeID: "text", role: "AXStaticText", name: "", value: "正文", depth: 4,
          actions: ["scroll"]),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"App\" [1]", "  - staticText = \"正文\" [2]"])
  }

  func testKeepsNamelessScrollAreaAsTheScrollTarget() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "sa", role: "AXScrollArea", name: "", value: nil, depth: 1,
          actions: ["focus", "scroll"]),
        raw(runtimeID: "t", role: "AXStaticText", name: "", value: "内容", depth: 2, actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"Main\" [1]", "  - scrollArea [2]", "    - staticText = \"内容\" [3]"])
  }

  func testKeepsStructuralRolesAndNeverNamesARowAfterItsCell() {
    // Only pure layout boxes are promoted. A nameless table/row also keeps its
    // role, and — measured on Chromium tables — a row must NOT adopt its first
    // cell's text as its own name: the cells are the structure the model reads,
    // so the row stays a row with both cells beneath it.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "table", role: "AXTable", name: "", value: nil, depth: 1, actions: []),
        raw(runtimeID: "r1", role: "AXRow", name: "", value: nil, depth: 2, actions: []),
        raw(runtimeID: "c1", role: "AXCell", name: "名称", value: nil, depth: 3, actions: []),
        raw(runtimeID: "c2", role: "AXCell", name: "大小", value: nil, depth: 3, actions: []),
        raw(runtimeID: "r2", role: "AXRow", name: "", value: nil, depth: 2, actions: []),
        raw(runtimeID: "c3", role: "AXCell", name: "路径", value: nil, depth: 3, actions: []),
        raw(runtimeID: "c4", role: "AXCell", name: "类型", value: nil, depth: 3, actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - table [2]",
        "    - row [3]",
        "      - cell \"名称\" [4]",
        "      - cell \"大小\" [5]",
        "    - row [6]",
        "      - cell \"路径\" [7]",
        "      - cell \"类型\" [8]",
      ])
  }

  func testSemanticSubroleEarnsALineButInlineStylingDoesNot() {
    // AXSubrole is the stable token for ARIA semantics. A landmark region tells
    // the model where it is; an inline styling group (code/strong) only
    // annotates a span, and its text survives as the promoted child.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "nav", role: "AXGroup", name: "", value: nil, depth: 1, actions: ["scroll"],
          subrole: "AXLandmarkNavigation"),
        raw(runtimeID: "navItem", role: "AXButton", name: "对话轮次导航", value: nil, depth: 2,
          actions: ["invoke"]),
        raw(runtimeID: "code", role: "AXGroup", name: "", value: nil, depth: 1, actions: ["scroll"],
          subrole: "AXCodeStyleGroup"),
        raw(runtimeID: "codeText", role: "AXStaticText", name: "", value: "swift build", depth: 2,
          actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - group [2]",
        "    - button \"对话轮次导航\" [3]",
        "  - staticText = \"swift build\" [4]",
      ])
  }

  func testDropsPressWrapperThatDuplicatesItsChildRectangle() {
    // Measured: AXGroup 155x27 with `invoke` wrapping AXButton "环境信息" over the
    // identical rectangle; pressing either one presses the same pixels.
    let box = NativeRect(x: 10, y: 10, width: 155, height: 27)
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "wrap", role: "AXGroup", name: "", value: nil, depth: 1,
          actions: ["invoke"], bounds: box),
        raw(runtimeID: "button", role: "AXButton", name: "环境信息", value: nil, depth: 2,
          actions: ["invoke"], bounds: box),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"Main\" [1]", "  - button \"环境信息\" [2]"])
  }

  func testKeepsPressWrapperWhenItsChildIsNotPressable() {
    // A clickable region whose only child is a decorative icon: folding the
    // wrapper would delete the only press target in that rectangle.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "wrap", role: "AXGroup", name: "", value: nil, depth: 1,
          actions: ["invoke"]),
        raw(runtimeID: "icon", role: "AXImage", name: "", value: nil, depth: 2, actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"Main\" [1]", "  - group [2]"])
  }

  func testPrunesBulletListMarkersButKeepsNumberedOnes() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "bullet", role: "AXListMarker", name: "", value: "•", depth: 1,
          actions: ["scroll"], roleDescription: "AXListMarker"),
        raw(runtimeID: "number", role: "AXListMarker", name: "", value: "1.", depth: 1,
          actions: ["scroll"], roleDescription: "AXListMarker"),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    // The marker that only draws a bullet is chrome; the ordered number is
    // content. A description that merely echoes the raw role falls back to the
    // camel-cased role word instead of leaking "AXListMarker" to the model.
    XCTAssertEqual(lines, ["- window \"Main\" [1]", "  - listMarker = \"1.\" [2]"])
  }

  func testLabelBearingContainerAdoptsItsLabelChild() {
    // Finder sidebar: AXCell (no name, no actions) with a text and an icon.
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Home", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "outline", role: "AXOutline", name: "Sidebar", value: nil, depth: 1,
          actions: []),
        raw(runtimeID: "cell", role: "AXCell", name: "", value: nil, depth: 2, actions: []),
        raw(runtimeID: "text", role: "AXStaticText", name: "", value: "最近使用", depth: 3,
          actions: []),
        raw(runtimeID: "icon", role: "AXImage", name: "时钟", value: nil, depth: 3, actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Home\" [1]",
        "  - outline \"Sidebar\" [2]",
        "    - cell \"最近使用\" [3]",
        "      - image \"时钟\" [4]",
      ])
  }

  func testPrunesScrollBarInternalsAndValueIndicators() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(runtimeID: "bar", role: "AXScrollBar", name: "", value: "0.2", depth: 1,
          actions: ["scroll"]),
        raw(runtimeID: "indicator", role: "AXValueIndicator", name: "", value: "0.2", depth: 2,
          actions: []),
        raw(runtimeID: "up", role: "AXButton", name: "上箭头按钮", value: nil, depth: 2,
          actions: ["invoke"]),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines.count, 2)
    XCTAssertTrue(lines[1].contains("scrollBar"))
    XCTAssertFalse(tree.text.contains("上箭头按钮"))
  }

  func testAmbientCapabilitiesDoNotKeepAChromiumWrapperChain() {
    // Chromium answers AXValue/AXSelectedTextRange settable for plain groups, so
    // the collector publishes [focus, select, set_value] on wrappers. None of
    // those justify a line, otherwise the whole chain survives.
    func wrapper(_ id: String, depth: Int) -> NativeAXRawElement {
      raw(runtimeID: id, role: "AXGroup", name: "", value: nil, depth: depth,
        actions: ["focus", "select", "set_value"])
    }
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Edge", value: nil, depth: 0,
          actions: ["focus"]),
        wrapper("g1", depth: 1),
        wrapper("g2", depth: 2),
        wrapper("g3", depth: 3),
        raw(runtimeID: "page", role: "AXWebArea", name: "Docs", value: nil, depth: 4,
          actions: []),
      ])
    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(lines, ["- window \"Edge\" [1]", "  - webArea \"Docs\" [2]"])
  }

  func testRendersCheckboxStateMarkerInsteadOfRawValue() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "c1", role: "AXCheckBox", name: "Auto connect", value: "1", depth: 0,
          actions: ["invoke"]),
        raw(runtimeID: "c2", role: "AXCheckBox", name: "Show icon", value: "0", depth: 0,
          actions: ["invoke"]),
      ])
    XCTAssertTrue(tree.text.contains("checkBox \"Auto connect\" [checked] [1]"))
    XCTAssertTrue(tree.text.contains("checkBox \"Show icon\" [unchecked] [2]"))
  }

  func testCollapsesMultilineValuesOntoASingleLine() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "s", role: "AXTextArea", name: "Notes", value: "line one\nline two\ttab",
          depth: 0, actions: ["set_value"])
      ])
    XCTAssertTrue(tree.text.contains("textArea \"Notes\" = \"line one line two tab\""))
  }

  func testBudgetTruncationEndsWithMarkerAndKeepsIdsContiguous() {
    var elements: [NativeAXRawElement] = [
      raw(runtimeID: "w", role: "AXWindow", name: "Big", value: nil, depth: 0,
        actions: ["focus"])
    ]
    let filler = String(repeating: "x", count: 900)
    for index in 0..<1_200 {
      elements.append(
        raw(
          runtimeID: "e\(index)", role: "AXStaticText", name: filler, value: nil, depth: 1,
          actions: []))
    }
    let tree = NativeAXTreeRenderer.render(elements)
    // The cap bounds the rendered LINES; the marker appended after them is
    // allowed to be longer, because it has to name what is missing and the
    // recovery (measured: an outline cut at 1019 lines hid the message input).
    XCTAssertLessThanOrEqual(
      tree.text.utf16.count, NativeAXTreeRenderer.maxTotalUTF16 + 240)
    XCTAssertTrue(tree.text.hasSuffix("]"))
    XCTAssertTrue(tree.text.contains("[truncated:"))
    XCTAssertTrue(
      tree.text.contains("screenshot is complete"), String(tree.text.suffix(200)))
    // Rendered ids stay dense and unique even when the tail was dropped.
    XCTAssertEqual(
      Set(tree.lines.map(\.elementID)).count, tree.lines.count)
    XCTAssertEqual(tree.lines.first?.elementID, "1")
  }

  func testDuplicateRuntimeIDsRenderDistinctLines() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "dup", role: "AXButton", name: "One", value: nil, depth: 0,
          actions: ["invoke"]),
        raw(runtimeID: "dup", role: "AXButton", name: "Two", value: nil, depth: 0,
          actions: ["invoke"]),
      ])
    XCTAssertEqual(
      tree.text.split(separator: "\n").map(String.init),
      [
        "- button \"One\" [1]",
        "- button \"Two\" [2]",
      ])
  }

  private func raw(
    runtimeID: String,
    role: String,
    name: String,
    value: String?,
    depth: Int,
    actions: [String],
    focused: Bool = false,
    roleDescription: String? = nil,
    placeholder: String? = nil,
    selected: Bool = false,
    childCount: Int = 0,
    subrole: String = "",
    bounds: NativeRect = NativeRect(x: 0, y: 0, width: 100, height: 30)
  ) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID,
      role: role,
      subrole: subrole,
      name: name,
      value: value,
      bounds: bounds,
      enabled: true,
      focused: focused,
      actions: actions,
      secure: false,
      depth: depth,
      roleDescription: roleDescription,
      placeholder: placeholder,
      selected: selected,
      childCount: childCount
    )
  }
}

final class NativeAXTreeRendererFieldTests: XCTestCase {
  func testPrefersRoleDescriptionOverRawRole() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(
          runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(
          runtimeID: "b", role: "AXButton", name: "OK", value: nil, depth: 1,
          actions: ["invoke"], roleDescription: "push button"),
      ])
    XCTAssertEqual(tree.text.components(separatedBy: "\n")[1], "  - push button \"OK\" [2]")
  }

  func testRendersPlaceholderOnlyForEmptyTextFields() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(
          runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(
          runtimeID: "e1", role: "AXSearchField", name: "", value: nil, depth: 1,
          actions: ["set_value"], placeholder: "Search products"),
        raw(
          runtimeID: "e2", role: "AXSearchField", name: "", value: "shoes", depth: 1,
          actions: ["set_value"], placeholder: "Search products"),
      ])
    let lines = tree.text.components(separatedBy: "\n")
    XCTAssertEqual(lines[1], "  - searchField placeholder=\"Search products\" [2]")
    // Filled field shows the value; the placeholder would be noise.
    XCTAssertEqual(lines[2], "  - searchField = \"shoes\" [3]")
  }

  func testRendersSelectedAndChildCountMarkers() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(
          runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        raw(
          runtimeID: "r1", role: "AXRow", name: "Inbox", value: nil, depth: 1,
          actions: ["select"], selected: true),
        raw(
          runtimeID: "r2", role: "AXRow", name: "Drafts", value: nil, depth: 1,
          actions: ["select"]),
        raw(
          runtimeID: "list", role: "AXList", name: "Messages", value: nil, depth: 1,
          actions: [], childCount: 1_250),
      ])
    let lines = tree.text.components(separatedBy: "\n")
    XCTAssertEqual(lines[1], "  - row \"Inbox\" [selected] [2]")
    XCTAssertEqual(lines[2], "  - row \"Drafts\" [3]")
    XCTAssertTrue(
      lines[3].contains("(1250 items, first 120 shown)"),
      "expected truncation note, got: \(lines[3])")
  }

  private func raw(
    runtimeID: String,
    role: String,
    name: String,
    value: String?,
    depth: Int,
    actions: [String],
    focused: Bool = false,
    roleDescription: String? = nil,
    placeholder: String? = nil,
    selected: Bool = false,
    childCount: Int = 0,
    subrole: String = "",
    bounds: NativeRect = NativeRect(x: 0, y: 0, width: 100, height: 30)
  ) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID,
      role: role,
      subrole: subrole,
      name: name,
      value: value,
      bounds: bounds,
      enabled: true,
      focused: focused,
      actions: actions,
      secure: false,
      depth: depth,
      roleDescription: roleDescription,
      placeholder: placeholder,
      selected: selected,
      childCount: childCount
    )
  }

  func testTraversalLimitNoticeNamesTheLimitAndTheRecovery() {
    // A traversal cut is invisible in the outline, so the notice has to say both
    // what was cut and what the model can do about it.
    let notice = NativeAXTreeRenderer.traversalLimitNotice(limit: 2000)
    XCTAssertTrue(notice.hasPrefix("[truncated:"))
    XCTAssertTrue(notice.contains("2000"))
    XCTAssertTrue(notice.contains("scroll"))
    XCTAssertFalse(notice.contains("\n"))
  }

  func testLongURLsShortenToOriginAndTail() {
    let long =
      "https://example.com/very/long/path/segment?query=abcdefghijklmnopqrstuvwxyz1234567890"
    let shortened = NativeAXTreeRenderer.shortenedURL(long)
    XCTAssertTrue(shortened.hasPrefix("https://example.com/\u{2026}"))
    XCTAssertLessThan(shortened.utf16.count, long.utf16.count)

    XCTAssertEqual(
      NativeAXTreeRenderer.shortenedURL("https://example.com"), "https://example.com")
    let plain = "just a long plain sentence that goes on and on and on for a while"
    XCTAssertEqual(NativeAXTreeRenderer.shortenedURL(plain), plain)
  }
}
