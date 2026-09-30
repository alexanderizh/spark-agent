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
  /// Process whose Chromium web-content tree has already been read once.
  /// Chromium builds that tree asynchronously after the `AXManualAccessibility`
  /// handshake and keeps it afterwards, so the bounded wait is only worth paying
  /// before the first successful read **of this process** — a second Chromium
  /// app in the same session starts from scratch. See `NativeWebTreeReadiness`.
  private var webTreeSeenForProcessID: pid_t?
  /// Windows of this process whose web-content tree never converged even after
  /// the bounded wait. Retrying the full schedule on every observation would
  /// make a genuine shell-only window (Electron tray popups, helper windows)
  /// cost ~1.8 s each time, so a window that already exhausted the wait is
  /// served immediately on later observations.
  private var exhaustedWebTreeWindows: Set<CFHashCode> = []
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
    let lazyWebTree = activateChromiumAccessibility(application)
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
      let snapshot = applyingNotices(
        try publishCached(
          cachedRawElements,
          previousTreeVersion: previousTreeVersion,
          fullTree: fullTree
        ),
        webTreePending: false,
        traversalTruncated: cachedRawElements.count >= Self.maxElements
      )
      recordPublishedSnapshot(snapshot)
      return snapshot
    }

    let tCollect = DispatchTime.now()
    var raw: [NativeAXRawElement] = []
    var elements: [String: AXUIElement] = [:]
    let windowFrame = elementBounds(window)
    try collect(
      window, path: "window", depth: 0, windowFrame: windowFrame, output: &raw,
      elements: &elements)

    // Chromium populates the web-content tree asynchronously after the
    // handshake above, and a backgrounded renderer can take seconds to answer.
    // Converge on "the document container exists and has content" instead of on
    // a raw element count, then wait with backoff — bounded, and skipped for
    // windows that already exhausted the wait. See NativeWebTreeReadiness for
    // the measurements behind this policy.
    let windowKey = CFHash(window)
    let webTreeSeenForProcess = webTreeSeenForProcessID == processID
    let firstPassCount = raw.count
    var attempts = 0
    var webTreePending = false
    if !exhaustedWebTreeWindows.contains(windowKey) {
      while NativeWebTreeReadiness.shouldRetry(
        acceptsManualAccessibility: lazyWebTree,
        elements: raw,
        attempts: attempts,
        webTreeSeenForProcess: webTreeSeenForProcess)
      {
        let delayMs = NativeWebTreeReadiness.retryDelaysMs[attempts]
        attempts += 1
        // The delays are pure waiting for the renderer, so never let the
        // traversal itself run with a stale element cache in between.
        if delayMs > 0 { Thread.sleep(forTimeInterval: Double(delayMs) / 1_000) }
        raw.removeAll(keepingCapacity: true)
        elements.removeAll(keepingCapacity: true)
        try collect(
          window, path: "window", depth: 0, windowFrame: windowFrame, output: &raw,
          elements: &elements)
        if NativeWebTreeReadiness.hasWebContent(raw) { break }
      }
      let stillPending = lazyWebTree && !NativeWebTreeReadiness.hasWebContent(raw)
      webTreePending =
        stillPending && raw.count <= NativeWebTreeReadiness.shellElementBudget
      if stillPending, attempts >= NativeWebTreeReadiness.retryDelaysMs.count {
        exhaustedWebTreeWindows.insert(windowKey)
      }
      if attempts > 0 || webTreePending {
        // Log both ends of the convergence: the first pass is what a host
        // without this loop would have published, so the line doubles as the
        // before/after evidence in main.log.
        writeHostDiagnostic(
          "ax_web_tree_readiness pid=\(processID) lazy_tree=\(lazyWebTree) "
            + "first_pass=\(firstPassCount) final=\(raw.count) attempts=\(attempts) "
            + "ready=\(!stillPending)"
        )
      }
    }
    if NativeWebTreeReadiness.hasWebContent(raw) { webTreeSeenForProcessID = processID }
    // Open menus / native dropdown lists are owned by the APPLICATION, not the
    // window, so a window-rooted traversal never sees them — after the agent
    // opens a menu the model would face a tree with zero menu items. Codex
    // merges open menus into its state; we do the same by walking the app's
    // focused element up to its root and, when that root is an AXMenu,
    // appending the whole menu tree BEFORE publishing (so ids, hit-testing and
    // semantic actions all cover the menu items). Defensive by design: any
    // miss simply leaves the tree unchanged.
    mergeOpenMenus(application: application, raw: &raw, elements: &elements)
    // Resolve "where input actually goes" before publishing: the tree is what
    // the model sees, and a wrong focus marker sends it to the wrong control.
    let focusedRaw = markTrueFocus(raw, elements: elements, processID: processID)
    dumpRawIfRequested(focusedRaw)
    traceMark("  collect(raw=\(raw.count))", tCollect)
    let tPublish = DispatchTime.now()
    let published = try publishCached(
      focusedRaw,
      previousTreeVersion: previousTreeVersion,
      fullTree: fullTree
    )
    // Say what the model is looking at: a shell-only tree is a transient state
    // of a lazy (Chromium) tree, not a small interface. Prepending the marker
    // keeps the element ids and their order untouched.
    let snapshot = applyingNotices(
      published,
      webTreePending: webTreePending,
      traversalTruncated: raw.count >= Self.maxElements
    )
    traceMark("  publish(lines=\(snapshot.text.split(separator: "\n").count))", tPublish)
    elementsByRuntimeID = elements
    boundsByElementID = Dictionary(
      uniqueKeysWithValues: snapshot.elements.map { ($0.id, $0.bounds) })
    recordPublishedSnapshot(snapshot)
    if webTreePending {
      // Never cache an unfinished tree: the cache is exactly what turned a
      // single mistimed first traversal into a persistently empty Electron
      // target for the following second.
      cachedRawElements.removeAll(keepingCapacity: true)
      lastTraversalUptime = 0
    } else {
      cachedRawElements = focusedRaw
      lastTraversalUptime = ProcessInfo.processInfo.systemUptime
    }
    cachedProcessID = processID
    cachedWindow = window
    cachedGeneration = generation
    return snapshot
  }

  /// Say what the model is NOT looking at.
  ///
  /// Two independent cuts can hide part of a window, and both used to be
  /// invisible in the published outline:
  ///  - a lazy Chromium tree that has not been built yet
  ///    (`NativeWebTreeReadiness.pendingNotice`), and
  ///  - a traversal that stopped at `maxElements` — measured on the packaged
  ///    SparkWork, which produced exactly 2000 elements with no marker at all, so
  ///    the outline simply appeared to end.
  /// Prepending/appending the markers keeps element ids and their order intact.
  private func applyingNotices(
    _ published: NativeAXTreeSnapshot,
    webTreePending: Bool,
    traversalTruncated: Bool
  ) -> NativeAXTreeSnapshot {
    var head: [String] = []
    if webTreePending { head.append(NativeWebTreeReadiness.pendingNotice) }
    var tail: [String] = []
    if traversalTruncated {
      tail.append(NativeAXTreeRenderer.traversalLimitNotice(limit: Self.maxElements))
    }
    guard !head.isEmpty || !tail.isEmpty else { return published }
    // The renderer's budget covers the outline plus its own truncation marker,
    // but these notices are joined afterwards — on a large window the joined
    // text can cross the TS-side hard cap (`MAX_TREE_PROMPT_CHARS`, same 48k),
    // which slices from the head and would drop the very notice that explains
    // the cut. Clamp the outline instead, on a line boundary, so the notices
    // always survive inside the same budget the client enforces.
    let separators = head.count + tail.count
    let noticeUnits = (head + tail).reduce(0) { $0 + $1.utf16.count } + separators
    let bodyBudget = max(0, NativeAXTreeRenderer.maxTotalUTF16 - noticeUnits)
    var body = published.text
    if body.utf16.count > bodyBudget { body = Self.outlineClamped(body, to: bodyBudget) }
    return NativeAXTreeSnapshot(
      treeVersion: published.treeVersion,
      mode: published.mode,
      text: (head + [body] + tail).joined(separator: "\n"),
      elements: published.elements,
      sensitiveRegions: published.sensitiveRegions)
  }

  /// Trims an outline to `limit` UTF-16 units on line boundaries, so the kept
  /// text never ends mid-line and the `[n]` element ids stay referenceable.
  private static func outlineClamped(_ text: String, to limit: Int) -> String {
    guard limit > 0 else { return "" }
    var units = 0
    var lines: [Substring] = []
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let lineUnits = line.utf16.count + (lines.isEmpty ? 0 : 1)
      if units + lineUnits > limit { break }
      units += lineUnits
      lines.append(line)
    }
    return lines.joined(separator: "\n")
  }

  /// Development aid: `SPARK_CU_DUMP_AX_RAW=<path>` writes the raw pre-order AX
  /// list (depth, role, role description, name, value, actions, flags, bounds)
  /// so tree-quality decisions can be measured against real applications instead
  /// of guessed — the published snapshot has no depth and drops every folded
  /// node, which is exactly the information needed to judge a folding rule.
  /// Unset in production; an unwritable path is ignored rather than fatal.
  private func dumpRawIfRequested(_ elements: [NativeAXRawElement]) {
    guard let path = ProcessInfo.processInfo.environment["SPARK_CU_DUMP_AX_RAW"],
      !path.isEmpty
    else { return }
    try? NativeAXRawDump.render(elements).write(
      toFile: path, atomically: true, encoding: .utf8)
  }

  /// Keeps `[focused]` on the element the application reports as its focused UI
  /// element, and only there.
  ///
  /// Per-element `AXFocused` is not trustworthy: measured on a Finder sidebar,
  /// 24 of 24 `AXCell`s reported `AXFocused = true` while `AXList` reported it
  /// too — 25 claims of focus for a single keyboard focus. The model uses the
  /// marker to decide where typing lands, so a wrong marker is worse than no
  /// marker. Fails open: if the focused element cannot be resolved, the
  /// collected flags are left untouched.
  private func markTrueFocus(
    _ raw: [NativeAXRawElement], elements: [String: AXUIElement], processID: pid_t
  ) -> [NativeAXRawElement] {
    guard raw.contains(where: \.focused) else { return raw }
    let application = AXUIElementCreateApplication(processID)
    AXUIElementSetMessagingTimeout(application, 2)
    guard var node: AXUIElement = copyAttribute(application, kAXFocusedUIElementAttribute) else {
      return raw
    }
    var targetRuntimeID: String?
    for _ in 0..<8 {
      if let match = elements.first(where: { CFEqual($0.value, node) })?.key {
        targetRuntimeID = match
        break
      }
      guard let parent: AXUIElement = copyAttribute(node, kAXParentAttribute) else { break }
      node = parent
    }
    guard let targetRuntimeID else { return raw }
    return raw.map { element in
      element.focused == (element.runtimeID == targetRuntimeID)
        ? element
        : element.replacingFocused(element.runtimeID == targetRuntimeID)
    }
  }

  /// Collects the app's currently open menu (menu-bar menus and native
  /// dropdown lists) into the shared buffers, bypassing offscreen pruning —
  /// menus render outside the window frame by design. See observe().
  private func mergeOpenMenus(
    application: AXUIElement,
    raw: inout [NativeAXRawElement],
    elements: inout [String: AXUIElement]
  ) {
    guard
      let focused: AXUIElement = copyAttribute(
        application, kAXFocusedUIElementAttribute)
    else { return }
    var node = focused
    for _ in 0..<32 {
      guard let parent: AXUIElement = copyAttribute(node, kAXParentAttribute) else { break }
      node = parent
    }
    let rootRole = copyAttribute(node, kAXRoleAttribute) ?? ""
    guard rootRole == "AXMenu" else { return }
    try? collect(
      node, path: "menu", depth: 0, windowFrame: nil, output: &raw, elements: &elements)
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
  /// - Returns: `true` when the app accepted `AXManualAccessibility`, i.e. it is
  ///   Chromium-derived and builds its web-content tree on demand. Native AppKit
  ///   apps answer `AXError.attributeUnsupported` (measured on Finder:
  ///   -25205), which makes this a precise "lazy tree" flag instead of a
  ///   bundle-identifier guess.
  @discardableResult
  private func activateChromiumAccessibility(_ application: AXUIElement) -> Bool {
    let accepted =
      AXUIElementSetAttributeValue(
        application, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
    // Not implemented by Chromium today (measured: -25208), harmless for the
    // other renderers and kept for the engines that do answer it.
    _ = AXUIElementSetAttributeValue(
      application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    return accepted
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
    // No focused window means no loader exists to watch — that is "not busy",
    // not "still loading". Treating it as busy pinned every background action
    // (the primary non-frontmost control path) to the full settle hard cap.
    guard let window: AXUIElement = copyAttribute(application, kAXFocusedWindowAttribute)
    else { return true }
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
    webTreeSeenForProcessID = nil
    exhaustedWebTreeWindows.removeAll(keepingCapacity: true)
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

  /// Reads a set of attributes in ONE XPC round trip.
  ///
  /// Falls back to per-attribute reads if the batched call is unavailable or
  /// answers with an unexpected shape — a single misbehaving app must never
  /// degrade the tree it can otherwise serve.
  private func readAttributes(
    _ element: AXUIElement, _ names: [String]
  ) -> NativeAXAttributeReader {
    var raw: CFArray?
    if AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &raw) == .success,
      let list = raw as? [Any], list.count == names.count
    {
      return NativeAXAttributeReader(
        names: names, values: NativeAXAttributeBatch.normalize(list))
    }
    let values: [Any?] = names.map { name in
      var value: CFTypeRef?
      guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
      }
      return value
    }
    return NativeAXAttributeReader(names: names, values: values)
  }

  /// Children of a container: `AXChildren` first (already read with the identity
  /// batch), then the role-specific fallback documented in `NativeAXChildSources`
  /// (`AXRows` for table/outline style containers). The fallback only runs when
  /// the primary list is empty, so it never costs a round trip for well-behaved
  /// containers.
  private func childElements(
    _ element: AXUIElement, identity: NativeAXAttributeReader, role: String
  ) -> [AXUIElement] {
    let primary = identity.elements(NativeAXChildSources.primaryAttribute)
    guard primary.isEmpty else { return primary }
    for attribute in NativeAXChildSources.candidates(forRole: role)
    where attribute != NativeAXChildSources.primaryAttribute {
      let fallback: [AXUIElement] = copyAttribute(element, attribute) ?? []
      if !fallback.isEmpty { return fallback }
    }
    return []
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
    let identity = readAttributes(element, NativeAXAttributeBatch.identityAttributes)
    let role = identity.string("AXRole") ?? "unknown"
    let subrole = identity.string("AXSubrole") ?? ""
    let identifier = identity.string("AXIdentifier") ?? ""
    let runtimeID = "\(path)|\(role)|\(identifier)"
    let bounds = elementBounds(position: identity.axValue("AXPosition"), size: identity.axValue("AXSize"))
    // Offscreen pruning runs BEFORE the content attributes are fetched: a pruned
    // subtree then costs two round trips instead of twenty. Conservative —
    // degenerate (0-size) elements are kept because web layouts report them with
    // live children, and the margin absorbs shadows/popovers that poke outside
    // the window frame.
    if depth > 0, let windowFrame,
      bounds.width > 0, bounds.height > 0,
      !intersects(bounds, expanded: windowFrame, margin: Self.offscreenMargin)
    {
      return
    }
    let children = childElements(element, identity: identity, role: role)
    let content = readAttributes(element, NativeAXAttributeBatch.contentAttributes)
    let secure = isSecure(
      content.bool("AXProtectedContent") ?? false, role: role, subrole: subrole)
    let name = firstNonempty([
      content.string("AXTitle"), content.string("AXDescription"), content.string("AXHelp"),
    ])
    let value: String?
    if secure {
      value = nil
    } else if let string = content.string("AXValue") {
      value = string
    } else if let number = content.number("AXValue") {
      value = number.stringValue
    } else {
      value = nil
    }
    let enabled = content.bool("AXEnabled") ?? true
    let focused = content.bool("AXFocused") ?? false
    let actions = supportedActions(element, secure: secure, role: role, hasChildren: !children.isEmpty)
    // Targeted extra attributes — fetched only for roles that can use them so
    // the per-element round-trip count stays bounded on 2000-element trees.
    var placeholder: String?
    if Self.placeholderRoles.contains(role), name.isEmpty, (value ?? "").isEmpty {
      placeholder = readAttributes(element, NativeAXAttributeBatch.placeholderAttributes)
        .string("AXPlaceholderValue")
    }
    let selected: Bool
    if Self.selectableRoles.contains(role) {
      selected = readAttributes(element, NativeAXAttributeBatch.selectionAttributes)
        .bool("AXSelected") ?? false
    } else {
      selected = false
    }
    output.append(
      NativeAXRawElement(
        runtimeID: runtimeID, role: role, subrole: subrole, name: name, value: value,
        bounds: bounds,
        enabled: enabled, focused: focused, actions: actions, secure: secure, depth: depth,
        roleDescription: content.string("AXRoleDescription"), placeholder: placeholder,
        selected: selected, childCount: children.count
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
  /// Roles for which `AXSelectedTextRange` describes a real text selection.
  private static let textSelectionRoles: Set<String> = [
    "AXTextField", "AXTextArea", "AXSearchField", "AXComboBox",
  ]
  private static let selectableRoles: Set<String> = [
    "AXRow", "AXCell", "AXColumn", "AXTab", "AXMenuItem", "AXMenuItemMarker", "AXListItem",
    "AXOutlineItem",
  ]
  private static let offscreenMargin: Double = 96

  private func supportedActions(
    _ element: AXUIElement, secure: Bool, role: String, hasChildren: Bool
  ) -> [String] {
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
    // Expanding a childless element is meaningless, so the probe is skipped
    // (one round trip saved on every leaf).
    if hasChildren, isSettable(element, kAXExpandedAttribute) {
      result.append(contentsOf: ["expand", "collapse"])
    }
    if !secure, isSettable(element, kAXValueAttribute) { result.append("set_value") }
    // AXSelectedTextRange is about a TEXT selection range: probing it on
    // containers is meaningless (AppKit and Chromium both answer true for plain
    // layout groups), and the resulting "select" capability is what made
    // coordinate clicks resolve to non-clickable wrappers.
    if !secure, Self.textSelectionRoles.contains(role),
      isSettable(element, kAXSelectedTextRangeAttribute)
    {
      result.append("select")
    }
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

private func elementBounds(position: AXValue?, size: AXValue?) -> NativeRect {
  var origin = CGPoint.zero
  var dimensions = CGSize(width: 1, height: 1)
  if let position, AXValueGetType(position) == .cgPoint {
    AXValueGetValue(position, .cgPoint, &origin)
  }
  if let size, AXValueGetType(size) == .cgSize {
    AXValueGetValue(size, .cgSize, &dimensions)
  }
  return NativeRect(
    x: origin.x, y: origin.y, width: max(1, dimensions.width), height: max(1, dimensions.height))
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

/// Convenience wrapper for call sites that only have the element: reads the
/// three attributes it needs (three round trips, so hot paths use the
/// value-based overload instead).
private func isSecure(_ element: AXUIElement) -> Bool {
  let role: String = copyAttribute(element, kAXRoleAttribute) ?? ""
  let subrole: String = copyAttribute(element, kAXSubroleAttribute) ?? ""
  let protectedContent = (copyAttribute(element, "AXProtectedContent") as NSNumber?)?.boolValue ?? false
  return isSecure(protectedContent, role: role, subrole: subrole)
}

private func isSecure(
  _ protectedContent: Bool, role: String, subrole: String
) -> Bool {
  let role = role
  let subrole = subrole
  let protected = protectedContent
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
    case .click(let normalized, let button, let count, let modifiers):
      let point = try map(normalized, bounds: windowBounds)
      let mouseButton = cgButton(button)
      let types = mouseTypes(button)
      let chordFlags = NativeMouseChord.flags(for: modifiers)
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
        down.flags = chordFlags
        up.flags = chordFlags
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
