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

  func testSkipsUnnamedValuelessActionlessLeafNoiseButKeepsContainers() {
    let tree = NativeAXTreeRenderer.render(
      [
        raw(runtimeID: "w", role: "AXWindow", name: "Main", value: nil, depth: 0,
          actions: ["focus"]),
        // Layout padding leaf: dropped.
        raw(runtimeID: "pad", role: "AXGroup", name: "", value: nil, depth: 1, actions: []),
        // Empty container with a child: kept, the child carries information.
        raw(runtimeID: "list", role: "AXList", name: "", value: nil, depth: 1, actions: []),
        raw(runtimeID: "item", role: "AXStaticText", name: "", value: "Row one", depth: 2,
          actions: []),
      ])

    let lines = tree.text.split(separator: "\n").map(String.init)
    XCTAssertEqual(
      lines,
      [
        "- window \"Main\" [1]",
        "  - list [2]",
        "    - staticText = \"Row one\" [3]",
      ])
    XCTAssertEqual(tree.omittedCount, 1)
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
    XCTAssertLessThanOrEqual(
      tree.text.utf16.count, NativeAXTreeRenderer.maxTotalUTF16 + 60)
    XCTAssertTrue(tree.text.hasSuffix("]"))
    XCTAssertTrue(tree.text.contains("[truncated:"))
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
    focused: Bool = false
  ) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID,
      role: role,
      name: name,
      value: value,
      bounds: NativeRect(x: 0, y: 0, width: 100, height: 30),
      enabled: true,
      focused: focused,
      actions: actions,
      secure: false,
      depth: depth
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
    childCount: Int = 0
  ) -> NativeAXRawElement {
    NativeAXRawElement(
      runtimeID: runtimeID,
      role: role,
      name: name,
      value: value,
      bounds: NativeRect(x: 0, y: 0, width: 100, height: 30),
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
