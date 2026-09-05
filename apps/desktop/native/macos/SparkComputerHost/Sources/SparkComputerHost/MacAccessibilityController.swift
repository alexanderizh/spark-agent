import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import Foundation
import SparkComputerHostCore

final class MacAccessibilityController: @unchecked Sendable {
  private static let maxDepth = 48
  private static let maxElements = maxNativeTreeElements

  private var tree = NativeAXTreeState()
  private var elementsByRuntimeID: [String: AXUIElement] = [:]
  private var boundsByElementID: [String: NativeRect] = [:]
  private var cachedRawElements: [NativeAXRawElement] = []
  private var cachedPublishedElements: [NativeAXElementRef] = []
  private var cachedTreeVersion: String?
  private var cachedProcessID: pid_t = 0
  private var cachedWindow: AXUIElement?
  private var lastTraversalUptime: TimeInterval = 0
  private var observer: AXObserver?
  private var observerSource: CFRunLoopSource?
  private let dirtyLock = NSLock()
  private var dirtyGeneration: UInt64 = 1
  private var cachedGeneration: UInt64 = 0

  var isAvailable: Bool {
    AXIsProcessTrusted()
  }

  func observe(
    processID: pid_t,
    preferredWindowBounds: NativeRect?,
    previousTreeVersion: String?,
    fullTree: Bool
  ) throws -> NativeAXTreeSnapshot {
    guard AXIsProcessTrusted() else { throw NativeHostPlatformError.accessibilityPermissionDenied }
    let application = AXUIElementCreateApplication(processID)
    AXUIElementSetMessagingTimeout(application, 2)
    // Chromium/Electron only build the web-content accessibility tree when
    // accessibility is explicitly enabled. Setting these attributes on the
    // application element flips Chromium's internal flag at runtime (no
    // restart). Non-Chromium apps reject them, which we ignore. This is the
    // single biggest reason competitors can read an Electron app's structure
    // tree while we previously saw an almost-empty tree.
    activateChromiumAccessibility(application)
    let window = try selectAXWindow(
      application: application,
      processID: processID,
      preferredBounds: preferredWindowBounds
    )

    let sameWindow = cachedProcessID == processID
      && cachedWindow.map { CFEqual($0, window) } == true
    if !sameWindow {
      configureObserver(processID: processID, application: application, window: window)
    }
    let generation = currentDirtyGeneration()
    if NativeAccessibilityCachePolicy.canReuse(
      sameTarget: sameWindow,
      subscriptionActive: observer != nil,
      cachedElementCount: cachedRawElements.count,
      cachedGeneration: cachedGeneration,
      currentGeneration: generation,
      age: ProcessInfo.processInfo.systemUptime - lastTraversalUptime,
      maxAge: 1
    ) {
      let snapshot = try publishCached(
        cachedRawElements,
        previousTreeVersion: previousTreeVersion,
        fullTree: fullTree
      )
      recordPublishedSnapshot(snapshot)
      return snapshot
    }

    var raw: [NativeAXRawElement] = []
    var elements: [String: AXUIElement] = [:]
    let windowFrame = elementBounds(window)
    try collect(
      window, path: "window", depth: 0, windowFrame: windowFrame, output: &raw,
      elements: &elements)
    // Chromium populates the web-content tree asynchronously after we flip
    // AXManualAccessibility. A near-empty first pass on a real window usually
    // means the tree is still being built — wait briefly and retry a couple
    // of times before giving up. Bounded and only triggered when the tree is
    // suspiciously small.
    if raw.count <= 3 {
      for _ in 0..<2 {
        Thread.sleep(forTimeInterval: 0.15)
        raw.removeAll(keepingCapacity: true)
        elements.removeAll(keepingCapacity: true)
        try collect(
          window, path: "window", depth: 0, windowFrame: windowFrame, output: &raw,
          elements: &elements)
        if raw.count > 3 { break }
      }
    }
    let snapshot = try publishCached(
      raw,
      previousTreeVersion: previousTreeVersion,
      fullTree: fullTree
    )
    elementsByRuntimeID = elements
    boundsByElementID = Dictionary(
      uniqueKeysWithValues: snapshot.elements.map { ($0.id, $0.bounds) })
    recordPublishedSnapshot(snapshot)
    cachedRawElements = raw
    cachedProcessID = processID
    cachedWindow = window
    lastTraversalUptime = ProcessInfo.processInfo.systemUptime
    cachedGeneration = generation
    return snapshot
  }

  private func recordPublishedSnapshot(_ snapshot: NativeAXTreeSnapshot) {
    cachedPublishedElements = snapshot.elements
    cachedTreeVersion = snapshot.treeVersion
  }

  /// Force Chromium-derived renderers (Electron, Chrome, Edge, Brave, ...)
  /// to construct their accessibility tree. Without this the AX tree of an
  /// Electron app is essentially empty (only the native chrome), which is
  /// the root cause of "we cannot read the structure tree". Idempotent and
  /// harmless for non-Chromium apps, which simply reject the attributes.
  private func activateChromiumAccessibility(_ application: AXUIElement) {
    _ = AXUIElementSetAttributeValue(
      application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    _ = AXUIElementSetAttributeValue(
      application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
  }

  /// Resolve the AX window we should traverse. Electron apps frequently own
  /// a tiny tray/status/widget window that the system reports as focused;
  /// naively reading kAXFocusedWindowAttribute binds us to that 66x20 window.
  /// Prefer the window matching the bound CG window bounds, then a usable
  /// focused window, then the largest usable window.
  private func selectAXWindow(
    application: AXUIElement,
    processID: pid_t,
    preferredBounds: NativeRect?
  ) throws -> AXUIElement {
    let windows: [AXUIElement] = copyAttribute(application, kAXWindowsAttribute) ?? []
    var usable: [(window: AXUIElement, bounds: NativeRect, focused: Bool)] = []
    for candidate in windows {
      let bounds = elementBounds(candidate)
      guard bounds.width >= 120, bounds.height >= 120 else { continue }
      let focused =
        (copyAttribute(candidate, kAXFocusedAttribute) as NSNumber?)?.boolValue ?? false
      usable.append((candidate, bounds, focused))
    }
    if let preferred = preferredBounds,
      let best = usable.min(by: {
        windowDistance($0.bounds, preferred) < windowDistance($1.bounds, preferred)
      }),
      windowDistance(best.bounds, preferred) <= 24
    {
      return best.window
    }
    if let focused = usable.first(where: { $0.focused }) { return focused.window }
    if let largest = usable.max(by: {
      $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height
    }) {
      return largest.window
    }
    if let focused: AXUIElement = copyAttribute(application, kAXFocusedWindowAttribute) {
      var actualPID: pid_t = 0
      if AXUIElementGetPid(focused, &actualPID) == .success, actualPID == processID {
        return focused
      }
    }
    throw NativeHostPlatformError.focusMismatch
  }

  private func windowDistance(_ left: NativeRect, _ right: NativeRect) -> Double {
    abs(left.x - right.x) + abs(left.y - right.y)
      + abs(left.width - right.width) + abs(left.height - right.height)
  }

  /// True when `bounds` overlaps `frame` grown by `margin` on every side.
  private func intersects(_ bounds: NativeRect, expanded frame: NativeRect, margin: Double) -> Bool
  {
    bounds.x < frame.x + frame.width + margin
      && bounds.x + bounds.width > frame.x - margin
      && bounds.y < frame.y + frame.height + margin
      && bounds.y + bounds.height > frame.y - margin
  }

  func execute(_ action: NativeComputerAction, treeVersion: String) throws -> NativeActionStatus {
    // Do not depend on AX notification delivery timing for the post-action observation.
    // Mark the cached tree stale before touching the target so the next observe traverses it.
    markDirty()
    switch action {
    case .invokeElement(let elementID, let requestedAction):
      let element = try resolve(elementID, treeVersion: treeVersion)
      try performSemanticAction(requestedAction ?? "invoke", on: element)
    case .setValue(let elementID, let value, _):
      try NativeInputPolicy.validateText(value, allowEmpty: true)
      try tree.assertWritable(elementID: elementID, treeVersion: treeVersion)
      let element = try resolve(elementID, treeVersion: treeVersion)
      guard isSettable(element, kAXValueAttribute),
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
          == .success
      else { throw NativeHostPlatformError.actionNoop }
    case .selectText(let elementID, let text, let prefix, let suffix):
      try tree.assertWritable(elementID: elementID, treeVersion: treeVersion)
      let element = try resolve(elementID, treeVersion: treeVersion)
      try selectText(text, prefix: prefix, suffix: suffix, in: element)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    return .executed
  }

  /// Geometric point → element hit over the cached tree of the observed window. Runs in
  /// the tree's own coordinate space, so occluding windows cannot hijack the hit the way
  /// AXUIElementCopyElementAtPosition would.
  func hitTestElement(
    point: NativeScreenPoint,
    treeVersion: String,
    capability: NativeAXHitCapability
  ) -> NativeAXElementRef? {
    guard cachedTreeVersion == treeVersion else { return nil }
    return NativeAXHitTest.target(at: point, in: cachedPublishedElements, capability: capability)
  }

  /// Background click: performs the activation action (AXPress / AXConfirm / AXPick) on
  /// the hit element without touching the global HID event stream or window focus.
  func performBackgroundClick(
    elementID: String, treeVersion: String, count: Int
  ) throws -> NativeActionStatus {
    let element = try resolve(elementID, treeVersion: treeVersion)
    let available = actionNames(element)
    let name: CFString
    if available.contains(kAXPressAction as String) {
      name = kAXPressAction as CFString
    } else if available.contains(kAXConfirmAction as String) {
      name = kAXConfirmAction as CFString
    } else if available.contains("AXPick") {
      name = "AXPick" as CFString
    } else {
      throw NativeHostPlatformError.actionNoop
    }
    // Same contract as `execute`: mark the cached tree stale before touching the target
    // so the next observe traverses it instead of trusting AX notification timing.
    markDirty()
    for _ in 0..<max(1, min(3, count)) {
      guard AXUIElementPerformAction(element, name) == .success else {
        throw NativeHostPlatformError.actionNoop
      }
    }
    return .executed
  }

  /// Background scroll: approximates the wheel delta with AXIncrement/AXDecrement on the
  /// hit scrollable container. Containers that only expose AXScrollToVisible cannot
  /// express a delta and fail here, which degrades to the foreground wheel path.
  func performBackgroundScroll(
    elementID: String, treeVersion: String, deltaX: Double, deltaY: Double
  ) throws -> NativeActionStatus {
    let element = try resolve(elementID, treeVersion: treeVersion)
    let available = actionNames(element)
    let increment = available.contains(kAXIncrementAction as String)
    let decrement = available.contains(kAXDecrementAction as String)
    guard increment || decrement else { throw NativeHostPlatformError.actionNoop }
    markDirty()
    func perform(_ delta: Double) throws {
      guard delta != 0 else { return }
      let positive = delta > 0
      guard positive ? increment : decrement else {
        throw NativeHostPlatformError.actionNoop
      }
      let action: CFString = positive ? kAXIncrementAction as CFString : kAXDecrementAction as CFString
      for _ in 0..<NativeBackgroundActionPolicy.scrollStepCount(forDelta: delta) {
        guard AXUIElementPerformAction(element, action) == .success else {
          throw NativeHostPlatformError.actionNoop
        }
      }
    }
    try perform(deltaY)
    try perform(deltaX)
    return .executed
  }

  /// Background typing: AXSetValue on the target application's focused element, bypassing
  /// the global HID stream (and therefore most IME interception). Inserts at the current
  /// selection like real typing would, falling back to appending at the end.
  func performBackgroundTypeText(processID: pid_t, text: String) throws -> NativeActionStatus {
    try NativeInputPolicy.validateText(text)
    let application = AXUIElementCreateApplication(processID)
    AXUIElementSetMessagingTimeout(application, 2)
    guard let element: AXUIElement = copyAttribute(application, kAXFocusedUIElementAttribute)
    else { throw NativeHostPlatformError.actionNoop }
    guard !isSecure(element) else { throw NativeHostPlatformError.sensitiveInputBlocked }
    guard isSettable(element, kAXValueAttribute) else {
      throw NativeHostPlatformError.actionNoop
    }
    let current: String = copyAttribute(element, kAXValueAttribute) ?? ""
    let nsCurrent = current as NSString
    var insertion = NSRange(location: nsCurrent.length, length: 0)
    if let selection: AXValue = copyAttribute(element, kAXSelectedTextRangeAttribute),
      AXValueGetType(selection) == .cfRange
    {
      var range = NSRange(location: NSNotFound, length: 0)
      AXValueGetValue(selection, .cfRange, &range)
      if range.location != NSNotFound, range.location <= nsCurrent.length,
        range.location + range.length <= nsCurrent.length
      {
        insertion = range
      }
    }
    let newValue = nsCurrent.replacingCharacters(in: insertion, with: text)
    markDirty()
    guard
      AXUIElementSetAttributeValue(
        element, kAXValueAttribute as CFString, newValue as CFTypeRef) == .success
    else { throw NativeHostPlatformError.actionNoop }
    if var caret = NSRange(location: insertion.location + (text as NSString).length, length: 0)
      as NSRange?
    {
      if let caretValue = AXValueCreate(.cfRange, &caret) {
        _ = AXUIElementSetAttributeValue(
          element, kAXSelectedTextRangeAttribute as CFString, caretValue)
      }
    }
    return .executed
  }

  func contains(elementID: String, treeVersion: String) -> Bool {
    guard
      let runtimeID = try? tree.resolve(
        elementID: elementID, treeVersion: treeVersion),
      let element = elementsByRuntimeID[runtimeID]
    else { return false }
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &value) == .success
  }

  func bounds(elementID: String, treeVersion: String) throws -> NativeRect {
    _ = try resolve(elementID, treeVersion: treeVersion)
    guard let bounds = boundsByElementID[elementID] else {
      throw NativeHostPlatformError.staleTree
    }
    return bounds
  }

  func loadingStopped(processID: pid_t) -> Bool {
    let application = AXUIElementCreateApplication(processID)
    guard let window: AXUIElement = copyAttribute(application, kAXFocusedWindowAttribute)
    else { return false }
    return !((copyAttribute(window, "AXElementBusy") as NSNumber?)?.boolValue ?? false)
  }

  /// Waits until the target app stops reacting to an injected action: no AX
  /// change notifications for a quiet window and no busy indicator, bounded by
  /// the policy's hard cap. Called between an action and its post-action
  /// observation so the returned tree/screenshot describe a settled UI instead
  /// of a mid-animation frame.
  func waitForSettle(processID: pid_t) async {
    let start = ProcessInfo.processInfo.systemUptime
    var lastGeneration = currentDirtyGeneration()
    var lastChange = start
    try? await Task.sleep(for: .milliseconds(NativeSettlePolicy.defaultBaselineMs))
    while true {
      let now = ProcessInfo.processInfo.systemUptime
      let generation = currentDirtyGeneration()
      if generation != lastGeneration {
        lastGeneration = generation
        lastChange = now
      }
      let busy = !loadingStopped(processID: processID)
      if NativeSettlePolicy.decide(
        elapsedMs: Int((now - start) * 1_000),
        msSinceLastChange: Int((now - lastChange) * 1_000),
        busy: busy) == .settled
      {
        return
      }
      try? await Task.sleep(for: .milliseconds(80))
    }
  }

  func focusedElementIsSecure(processID: pid_t) -> Bool {
    let application = AXUIElementCreateApplication(processID)
    guard let element: AXUIElement = copyAttribute(application, kAXFocusedUIElementAttribute)
    else { return false }
    return isSecure(element)
  }

  func invalidate() {
    tree.invalidate()
    elementsByRuntimeID.removeAll(keepingCapacity: true)
    boundsByElementID.removeAll(keepingCapacity: true)
    cachedRawElements.removeAll(keepingCapacity: true)
    cachedPublishedElements.removeAll(keepingCapacity: true)
    cachedTreeVersion = nil
    cachedProcessID = 0
    cachedWindow = nil
    lastTraversalUptime = 0
    removeObserver()
    markDirty()
  }

  func markDirty() {
    dirtyLock.withLock {
      dirtyGeneration &+= 1
      if dirtyGeneration == 0 { dirtyGeneration = 1 }
    }
  }

  private func currentDirtyGeneration() -> UInt64 {
    dirtyLock.withLock { dirtyGeneration }
  }

  private func publishCached(
    _ raw: [NativeAXRawElement],
    previousTreeVersion: String?,
    fullTree: Bool
  ) throws -> NativeAXTreeSnapshot {
    let snapshot = tree.publish(
      elements: raw,
      previousTreeVersion: previousTreeVersion,
      fullTree: fullTree
    )
    guard snapshot.elements.count <= Self.maxElements, snapshot.text.utf16.count <= 2_000_000 else {
      tree.invalidate()
      throw NativeHostPlatformError.resourceLimitExceeded
    }
    return snapshot
  }

  private func configureObserver(
    processID: pid_t,
    application: AXUIElement,
    window: AXUIElement
  ) {
    removeObserver()
    markDirty()
    var created: AXObserver?
    guard AXObserverCreate(processID, macAccessibilityObserverCallback, &created) == .success,
      let created
    else { return }
    let refcon = Unmanaged.passUnretained(self).toOpaque()
    for notification in [
      kAXFocusedWindowChangedNotification,
      kAXFocusedUIElementChangedNotification,
    ] {
      _ = AXObserverAddNotification(created, application, notification as CFString, refcon)
    }
    for notification in [
      kAXValueChangedNotification,
      kAXUIElementDestroyedNotification,
      kAXMovedNotification,
      kAXResizedNotification,
      kAXTitleChangedNotification,
      kAXCreatedNotification,
      kAXSelectedTextChangedNotification,
      kAXLayoutChangedNotification,
    ] {
      _ = AXObserverAddNotification(created, window, notification as CFString, refcon)
    }
    let source = AXObserverGetRunLoopSource(created)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    observer = created
    observerSource = source
  }

  private func removeObserver() {
    if let observerSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), observerSource, .commonModes)
    }
    observerSource = nil
    observer = nil
  }

  private func resolve(_ elementID: String, treeVersion: String) throws -> AXUIElement {
    let runtimeID: String
    do {
      runtimeID = try tree.resolve(elementID: elementID, treeVersion: treeVersion)
    } catch NativeControlPolicyError.staleTree {
      throw NativeHostPlatformError.staleTree
    } catch {
      throw NativeHostPlatformError.staleTree
    }
    guard let element = elementsByRuntimeID[runtimeID] else {
      throw NativeHostPlatformError.staleTree
    }
    var processID: pid_t = 0
    guard AXUIElementGetPid(element, &processID) == .success, processID > 0 else {
      throw NativeHostPlatformError.staleTree
    }
    return element
  }

  private func collect(
    _ element: AXUIElement,
    path: String,
    depth: Int,
    windowFrame: NativeRect?,
    output: inout [NativeAXRawElement],
    elements: inout [String: AXUIElement]
  ) throws {
    guard depth <= Self.maxDepth, output.count < Self.maxElements else { return }
    let role: String = copyAttribute(element, kAXRoleAttribute) ?? "unknown"
    let subrole: String = copyAttribute(element, kAXSubroleAttribute) ?? ""
    let identifier: String = copyAttribute(element, kAXIdentifierAttribute) ?? ""
    let runtimeID = "\(path)|\(role)|\(identifier)"
    let secure = isSecure(element, role: role, subrole: subrole)
    let name = firstNonempty([
      copyAttribute(element, kAXTitleAttribute),
      copyAttribute(element, kAXDescriptionAttribute),
      copyAttribute(element, kAXHelpAttribute),
    ])
    let value: String?
    if secure {
      value = nil
    } else if let string: String = copyAttribute(element, kAXValueAttribute) {
      value = string
    } else if let number: NSNumber = copyAttribute(element, kAXValueAttribute) {
      value = number.stringValue
    } else {
      value = nil
    }
    let enabled: Bool =
      (copyAttribute(element, kAXEnabledAttribute) as NSNumber?)?.boolValue ?? true
    let focused: Bool =
      (copyAttribute(element, kAXFocusedAttribute) as NSNumber?)?.boolValue ?? false
    let bounds = elementBounds(element)
    // Offscreen pruning: a fully offscreen subtree (native table views expose
    // every row, on- and offscreen alike) is invisible to the model and only
    // burns traversal budget. Conservative — degenerate (0-size) elements are
    // kept because web layouts report them with live children, and the margin
    // absorbs shadows/popovers that poke outside the window frame.
    if depth > 0, let windowFrame,
      bounds.width > 0, bounds.height > 0,
      !intersects(bounds, expanded: windowFrame, margin: Self.offscreenMargin)
    {
      return
    }
    let actions = supportedActions(element, secure: secure)
    // Targeted extra attributes — fetched only for roles that can use them so
    // the per-element XPC cost stays bounded on 2000-element trees.
    let roleDescription: String? = copyAttribute(element, kAXRoleDescriptionAttribute)
    let placeholder: String?
    if Self.placeholderRoles.contains(role), name.isEmpty, (value ?? "").isEmpty {
      placeholder = copyAttribute(element, "AXPlaceholderValue")
    } else {
      placeholder = nil
    }
    let selected: Bool =
      Self.selectableRoles.contains(role)
      ? (copyAttribute(element, "AXSelected") as NSNumber?)?.boolValue ?? false : false
    let children: [AXUIElement] = copyAttribute(element, kAXChildrenAttribute) ?? []
    output.append(
      NativeAXRawElement(
        runtimeID: runtimeID, role: role, name: name, value: value, bounds: bounds,
        enabled: enabled, focused: focused, actions: actions, secure: secure, depth: depth,
        roleDescription: roleDescription, placeholder: placeholder, selected: selected,
        childCount: children.count
      )
    )
    elements[runtimeID] = element
    for (index, child) in children.enumerated() {
      if index >= NativeAXTreeRenderer.maxChildrenPerContainer { break }
      if output.count >= Self.maxElements { break }
      try collect(
        child, path: "\(path).\(index)", depth: depth + 1, windowFrame: windowFrame,
        output: &output, elements: &elements)
    }
  }

  private static let placeholderRoles: Set<String> = [
    "AXTextField", "AXTextArea", "AXSearchField", "AXComboBox",
  ]
  private static let selectableRoles: Set<String> = [
    "AXRow", "AXCell", "AXColumn", "AXTab", "AXMenuItem", "AXMenuItemMarker", "AXListItem",
    "AXOutlineItem",
  ]
  private static let offscreenMargin: Double = 96

  private func supportedActions(_ element: AXUIElement, secure: Bool) -> [String] {
    var rawNames: CFArray?
    let names: [String]
    if AXUIElementCopyActionNames(element, &rawNames) == .success,
      let array = rawNames as? [String]
    {
      names = array
    } else {
      names = []
    }
    var result: [String] = []
    if names.contains(kAXPressAction as String) || names.contains(kAXConfirmAction as String) {
      result.append("invoke")
    }
    if names.contains("AXPick") { result.append("select") }
    if isSettable(element, kAXFocusedAttribute) || names.contains(kAXRaiseAction as String) {
      result.append("focus")
    }
    if isSettable(element, kAXExpandedAttribute) {
      result.append(contentsOf: ["expand", "collapse"])
    }
    if !secure, isSettable(element, kAXValueAttribute) { result.append("set_value") }
    if !secure, isSettable(element, kAXSelectedTextRangeAttribute) { result.append("select") }
    if names.contains(where: { $0.hasPrefix("AXScroll") }) { result.append("scroll") }
    return Array(Set(result)).sorted()
  }

  private func performSemanticAction(_ action: String, on element: AXUIElement) throws {
    let result: AXError
    switch action {
    case "invoke":
      let available = actionNames(element)
      let name =
        available.contains(kAXPressAction as String)
        ? kAXPressAction as CFString : kAXConfirmAction as CFString
      result = AXUIElementPerformAction(element, name)
    case "select":
      result = AXUIElementPerformAction(element, "AXPick" as CFString)
    case "focus":
      result = AXUIElementSetAttributeValue(
        element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    case "expand":
      result = AXUIElementSetAttributeValue(
        element, kAXExpandedAttribute as CFString, kCFBooleanTrue)
    case "collapse":
      result = AXUIElementSetAttributeValue(
        element, kAXExpandedAttribute as CFString, kCFBooleanFalse)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    guard result == .success else { throw NativeHostPlatformError.actionNoop }
  }

  private func selectText(
    _ needle: String, prefix: String?, suffix: String?, in element: AXUIElement
  ) throws {
    guard let value: String = copyAttribute(element, kAXValueAttribute) else {
      throw NativeHostPlatformError.actionNoop
    }
    let nsValue = value as NSString
    var searchRange = NSRange(location: 0, length: nsValue.length)
    var selected: NSRange?
    while searchRange.length >= 0 {
      let match = nsValue.range(of: needle, options: [], range: searchRange)
      if match.location == NSNotFound { break }
      let beforeMatches =
        prefix.map { prefixValue in
          match.location >= (prefixValue as NSString).length
            && nsValue.substring(
              with: NSRange(
                location: match.location - (prefixValue as NSString).length,
                length: (prefixValue as NSString).length)) == prefixValue
        } ?? true
      let afterMatches =
        suffix.map { suffixValue in
          let start = match.location + match.length
          return start + (suffixValue as NSString).length <= nsValue.length
            && nsValue.substring(
              with: NSRange(
                location: start, length: (suffixValue as NSString).length)) == suffixValue
        } ?? true
      if beforeMatches && afterMatches {
        selected = match
        break
      }
      let next = match.location + max(match.length, 1)
      if next > nsValue.length { break }
      searchRange = NSRange(location: next, length: nsValue.length - next)
    }
    guard var range = selected,
      let axRange = AXValueCreate(.cfRange, &range),
      AXUIElementSetAttributeValue(
        element, kAXSelectedTextRangeAttribute as CFString, axRange) == .success
    else { throw NativeHostPlatformError.actionNoop }
  }
}

private func macAccessibilityObserverCallback(
  _ observer: AXObserver,
  _ element: AXUIElement,
  _ notification: CFString,
  _ refcon: UnsafeMutableRawPointer?
) {
  guard let refcon else { return }
  Unmanaged<MacAccessibilityController>
    .fromOpaque(refcon)
    .takeUnretainedValue()
    .markDirty()
}

private func copyAttribute<Value>(
  _ element: AXUIElement, _ attribute: String
) -> Value? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
    let value
  else { return nil }
  return value as? Value
}

private func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
  var settable = DarwinBoolean(false)
  return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success
    && settable.boolValue
}

private func actionNames(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return names as? [String] ?? []
}

private func firstNonempty(_ values: [String?]) -> String {
  values.compactMap { $0 }.first { !$0.isEmpty } ?? ""
}

private func elementBounds(_ element: AXUIElement) -> NativeRect {
  var origin = CGPoint.zero
  var size = CGSize(width: 1, height: 1)
  if let value: AXValue = copyAttribute(element, kAXPositionAttribute),
    AXValueGetType(value) == .cgPoint
  {
    AXValueGetValue(value, .cgPoint, &origin)
  }
  if let value: AXValue = copyAttribute(element, kAXSizeAttribute),
    AXValueGetType(value) == .cgSize
  {
    AXValueGetValue(value, .cgSize, &size)
  }
  return NativeRect(
    x: origin.x, y: origin.y, width: max(1, size.width), height: max(1, size.height))
}

private func isSecure(
  _ element: AXUIElement, role: String? = nil, subrole: String? = nil
) -> Bool {
  let role = role ?? copyAttribute(element, kAXRoleAttribute) ?? ""
  let subrole = subrole ?? copyAttribute(element, kAXSubroleAttribute) ?? ""
  let protected = (copyAttribute(element, "AXProtectedContent") as NSNumber?)?.boolValue ?? false
  let marker = "\(role) \(subrole)".lowercased()
  return protected || marker.contains("securetextfield") || marker.contains("password")
}

enum MacCGEventController {
  static var isAvailable: Bool {
    CGPreflightPostEventAccess() && CGEventSource(stateID: .hidSystemState) != nil
  }

  static func execute(
    _ action: NativeComputerAction,
    windowBounds: NativeRect,
    scrollTargetBounds: NativeRect? = nil,
    validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws -> NativeActionStatus {
    guard isAvailable else { throw NativeHostPlatformError.accessibilityPermissionDenied }
    switch action {
    case .click(let normalized, let button, let count):
      let point = try map(normalized, bounds: windowBounds)
      let mouseButton = cgButton(button)
      let types = mouseTypes(button)
      let total = max(1, min(3, count ?? 1))
      for index in 0..<total {
        try await validateTarget()
        guard
          let down = CGEvent(
            mouseEventSource: nil, mouseType: types.0, mouseCursorPosition: point,
            mouseButton: mouseButton),
          let up = CGEvent(
            mouseEventSource: nil, mouseType: types.1, mouseCursorPosition: point,
            mouseButton: mouseButton)
        else { throw NativeHostPlatformError.actionNoop }
        down.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(index + 1))
        postTagged(down)
        // Codex's measured human rhythm: a short press (~40ms) inside the
        // down→up pair and ~100ms between consecutive clicks. Instant
        // down/up pairs read as synthetic to some apps and drop double-clicks.
        try await Task.sleep(for: .milliseconds(40))
        postTagged(up)
        if index < total - 1 {
          try await Task.sleep(for: .milliseconds(100))
        }
      }
    case .move(let normalized):
      try await validateTarget()
      let point = try map(normalized, bounds: windowBounds)
      guard
        let event = CGEvent(
          mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point,
          mouseButton: .left)
      else { throw NativeHostPlatformError.actionNoop }
      postTagged(event)
    case .drag(let from, let to, let durationMs):
      let start = try map(from, bounds: windowBounds)
      let end = try map(to, bounds: windowBounds)
      try postMouse(type: .mouseMoved, at: start, button: .left)
      try await validateTarget()
      try postMouse(type: .leftMouseDown, at: start, button: .left)
      var current = start
      defer { try? postMouse(type: .leftMouseUp, at: current, button: .left) }
      let duration = durationMs ?? 250
      let steps = max(1, min(120, duration / 16))
      for step in 1...steps {
        try await validateTarget()
        let ratio = Double(step) / Double(steps)
        let point = CGPoint(
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio)
        current = point
        try postMouse(type: .leftMouseDragged, at: point, button: .left)
        try await Task.sleep(for: .milliseconds(max(1, duration / steps)))
      }
    case .scroll(_, let normalized, let deltaX, let deltaY):
      try await validateTarget()
      let point: CGPoint
      if let normalized {
        point = try map(normalized, bounds: windowBounds)
      } else if let target = scrollTargetBounds {
        let center = NativeScreenPoint(
          x: target.x + target.width / 2, y: target.y + target.height / 2)
        guard contains(center, in: windowBounds) else {
          throw NativeHostPlatformError.invalidWindowGeometry
        }
        point = CGPoint(x: center.x, y: center.y)
      } else {
        point = try map(NativeNormalizedPoint(x: 0.5, y: 0.5), bounds: windowBounds)
      }
      try postMouse(type: .mouseMoved, at: point, button: .left)
      guard
        let event = CGEvent(
          scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2,
          wheel1: Int32((-deltaY).rounded()), wheel2: Int32((-deltaX).rounded()), wheel3: 0)
      else { throw NativeHostPlatformError.actionNoop }
      postTagged(event)
    case .keypress(let keys):
      try NativeInputPolicy.validateKeys(keys)
      try await postKeyChord(keys, validateTarget: validateTarget)
    case .typeText(let text, _):
      try NativeInputPolicy.validateText(text)
      try await postText(text, validateTarget: validateTarget)
    default:
      throw NativeHostPlatformError.actionNotAllowed
    }
    return .executed
  }

  private static func map(_ point: NativeNormalizedPoint, bounds: NativeRect) throws -> CGPoint {
    let mapped = try NativeInputPolicy.screenPoint(
      normalizedX: point.x, normalizedY: point.y, windowBounds: bounds)
    return CGPoint(x: mapped.x, y: mapped.y)
  }

  private static func contains(_ point: NativeScreenPoint, in bounds: NativeRect) -> Bool {
    point.x >= bounds.x && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y && point.y <= bounds.y + bounds.height
  }

  private static func postMouse(type: CGEventType, at point: CGPoint, button: CGMouseButton) throws
  {
    guard
      let event = CGEvent(
        mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    else { throw NativeHostPlatformError.actionNoop }
    postTagged(event)
  }

  private static func cgButton(_ value: String?) -> CGMouseButton {
    switch value {
    case "right": .right
    case "middle": .center
    default: .left
    }
  }

  private static func mouseTypes(_ value: String?) -> (CGEventType, CGEventType) {
    switch value {
    case "right": (.rightMouseDown, .rightMouseUp)
    case "middle": (.otherMouseDown, .otherMouseUp)
    default: (.leftMouseDown, .leftMouseUp)
    }
  }

  private static func postKeyChord(
    _ keys: [String], validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws {
    var flags: CGEventFlags = []
    for key in keys {
      switch key {
      case "Meta": flags.insert(.maskCommand)
      case "Control": flags.insert(.maskControl)
      case "Alt": flags.insert(.maskAlternate)
      case "Shift": flags.insert(.maskShift)
      default: continue
      }
    }
    let nonModifiers = keys.filter { !["Meta", "Control", "Alt", "Shift"].contains($0) }
    guard !nonModifiers.isEmpty else { throw NativeHostPlatformError.actionNotAllowed }
    for key in nonModifiers {
      try await validateTarget()
      if let code = keyCode(key) {
        var keyFlags = flags
        // A shifted symbol ("!", "@", "{", ...) shares the base key's virtual keycode
        // and only produces the symbol with the shift modifier applied — the
        // layout resolver reports the same for uppercase on any layout.
        if NativeKeySymbols.isShiftedSymbol(key) || keyRequiresShift(key) {
          keyFlags.insert(.maskShift)
        }
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
        else { throw NativeHostPlatformError.actionNoop }
        down.flags = keyFlags
        up.flags = keyFlags
        postTagged(down)
        postTagged(up)
      } else {
        throw NativeHostPlatformError.actionNotAllowed
      }
    }
  }

  private static func postText(
    _ text: String, validateTarget: @escaping @Sendable () async throws -> Void
  ) async throws {
    var chunk = ""
    for scalar in text.unicodeScalars {
      let value = String(scalar)
      if chunk.utf16.count + value.utf16.count > 32 {
        try await validateTarget()
        try postUnicode(chunk, flags: [])
        // 8ms between chunks: 2ms measurably dropped characters on slower apps
        // (Electron text fields round-trip each HID event through the renderer).
        try await Task.sleep(for: .milliseconds(8))
        chunk = ""
      }
      chunk.append(value)
    }
    if !chunk.isEmpty {
      try await validateTarget()
      try postUnicode(chunk, flags: [])
    }
  }

  private static func postUnicode(_ text: String, flags: CGEventFlags) throws {
    let units = Array(text.utf16)
    guard !units.isEmpty, units.count <= 32,
      let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true),
      let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
    else { throw NativeHostPlatformError.actionNoop }
    units.withUnsafeBufferPointer { buffer in
      down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
      up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress!)
    }
    down.flags = flags
    up.flags = flags
    postTagged(down)
    postTagged(up)
  }

  private static func postTagged(_ event: CGEvent) {
    event.setIntegerValueField(.eventSourceUserData, value: sparkComputerInjectedEventTag)
    event.post(tap: .cghidEventTap)
  }

  /// True when the current keyboard layout needs Shift held to produce the
  /// character (uppercase letters on every layout; layout-specific symbols).
  private static func keyRequiresShift(_ key: String) -> Bool {
    let base = NativeKeySymbols.baseCharacter(for: key) ?? key
    guard let character = base.first, base.count == 1 else { return false }
    return NativeKeyCodeLayout.resolve(character: character)?.shift == true
  }

  static func keyCode(_ value: String) -> CGKeyCode? {
    let named: [String: CGKeyCode] = [
      "Backspace": 51, "Delete": 117, "End": 119, "Enter": 36, "Escape": 53,
      "Home": 115, "PageDown": 121, "PageUp": 116, "Space": 49, "Tab": 48,
      "ArrowDown": 125, "ArrowLeft": 123, "ArrowRight": 124, "ArrowUp": 126,
      "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
      "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
      "F13": 105, "F14": 107, "F15": 113, "F16": 106, "F17": 64, "F18": 79,
      "F19": 80, "F20": 90,
    ]
    if let code = named[value] { return code }
    // Layout-aware resolution first (non-US layouts map characters to
    // different physical keys); the US table inside NativeKeyCodeLayout is
    // the fallback.
    let character: Character?
    if let base = NativeKeySymbols.baseCharacter(for: value), let first = base.first {
      character = first
    } else if value.count == 1 {
      character = value.first
    } else {
      character = nil
    }
    guard let character else { return nil }
    return NativeKeyCodeLayout.resolve(character: character)?.code
  }
}
