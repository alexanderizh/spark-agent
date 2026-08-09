import AppKit
@preconcurrency import ApplicationServices
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import CryptoKit
import Foundation
import ImageIO
@preconcurrency import ScreenCaptureKit
import Security
import SparkComputerHostCore
import UniformTypeIdentifiers
import Vision

actor MacScreenCaptureProvider: NativeHostPlatformProviding {
  private static let hostVersion = "0.1.0"
  private var screenPermissionWasDenied = false
  private var accessibilityPermissionWasDenied = false
  private var inputPermissionWasDenied = false
  private let accessibility = MacAccessibilityController()
  private let userInput = MacUserInputMonitor()
  private var observation: ObservationBinding?
  private var canceledSessions: Set<String> = []
  private var persistentCapture: MacPersistentWindowCapture?
  private var persistentCaptureBindingKey: String?

  func capabilityManifest() -> NativeCapabilityManifest {
    let permission: String
    if CGPreflightScreenCaptureAccess() {
      permission = "granted"
    } else if screenPermissionWasDenied {
      permission = "denied"
    } else {
      permission = "not_determined"
    }
    let accessibilityAvailable = captureIsSupported && accessibility.isAvailable
    return .macosScreenCapture(
      hostVersion: Self.hostVersion,
      architecture: hostArchitecture,
      screenPermission: permission,
      accessibilityPermission: accessibilityPermission,
      inputPermission: inputPermission,
      captureWindowSupported: captureIsSupported,
      accessibilityAvailable: accessibilityAvailable,
      inputAvailable: captureIsSupported && MacCGEventController.isAvailable && userInput.isAvailable
    )
  }

  func requestPermissions(
    _ permissions: [NativeHostPermissionRequest]
  ) -> NativeCapabilityManifest {
    for permission in permissions {
      switch permission {
      case .screen:
        screenPermissionWasDenied = !CGRequestScreenCaptureAccess()
      case .accessibility:
        let options =
          [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
          ] as CFDictionary
        accessibilityPermissionWasDenied = !AXIsProcessTrustedWithOptions(options)
        inputPermissionWasDenied = !CGRequestPostEventAccess()
      }
    }
    userInput.ensureStarted()
    return capabilityManifest()
  }

  func listWindows() async throws -> [NativeWindowDescriptor] {
    let content = try await loadShareableContent()
    let displays = content.displays.map {
      RawNativeDisplay(
        id: String($0.displayID),
        pixelWidth: $0.width,
        pixelHeight: $0.height,
        frame: NativeRect(
          x: $0.frame.origin.x,
          y: $0.frame.origin.y,
          width: $0.frame.width,
          height: $0.frame.height
        )
      )
    }
    let focusedWindowID = frontmostWindowID()
    var identities: [pid_t: CodeIdentity] = [:]
    let windows = content.windows.compactMap { window -> RawNativeWindow? in
      guard let application = window.owningApplication,
        application.processID != ProcessInfo.processInfo.processIdentifier,
        window.frame.width > 0,
        window.frame.height > 0
      else { return nil }
      let identity =
        identities[application.processID]
        ?? inspectCodeIdentity(
          processID: application.processID
        )
      identities[application.processID] = identity
      return RawNativeWindow(
        id: String(window.windowID),
        title: window.title ?? "",
        frame: NativeRect(
          x: window.frame.origin.x,
          y: window.frame.origin.y,
          width: window.frame.width,
          height: window.frame.height
        ),
        isOnScreen: window.isOnScreen,
        processID: application.processID,
        applicationName: application.applicationName,
        bundleID: application.bundleIdentifier,
        executableIdentity: identity.identifier ?? application.bundleIdentifier,
        signingIdentity: identity.teamIdentifier
      )
    }
    return try NativeWindowInventoryMapper.map(
      windows: windows,
      displays: displays,
      focusedWindowID: focusedWindowID
    )
  }

  func captureWindow(id: String) async throws -> NativeCapturedWindow {
    try await captureWindowOnce(id: id)
  }

  private func captureWindowOnce(id: String) async throws -> NativeCapturedWindow {
    guard captureIsSupported else { throw NativeHostPlatformError.captureFailed }
    guard let windowID = NativeWindowIDParser.parse(id) else {
      throw NativeHostPlatformError.windowNotFound
    }
    let content = try await loadShareableContent()
    guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
      throw NativeHostPlatformError.windowNotFound
    }
    guard window.frame.width > 0, window.frame.height > 0 else {
      throw NativeHostPlatformError.invalidWindowGeometry
    }
    guard #available(macOS 14.0, *) else {
      throw NativeHostPlatformError.captureFailed
    }

    let scaleFactor = displayScale(for: window, displays: content.displays)
    let width = max(1, min(16_384, Int((window.frame.width * scaleFactor).rounded())))
    let height = max(1, min(16_384, Int((window.frame.height * scaleFactor).rounded())))
    let configuration = SCStreamConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.showsCursor = true
    configuration.ignoreShadowsSingleWindow = false
    let filter = SCContentFilter(desktopIndependentWindow: window)
    do {
      let image = try await SCScreenshotManager.captureImage(
        contentFilter: filter,
        configuration: configuration
      )
      return NativeCapturedWindow(
        bytes: try encodePNG(image),
        width: image.width,
        height: image.height
      )
    } catch {
      if !CGPreflightScreenCaptureAccess() {
        screenPermissionWasDenied = true
        throw NativeHostPlatformError.screenPermissionDenied
      }
      throw NativeHostPlatformError.captureFailed
    }
  }

  func observe(
    snapshotID: String,
    appID: String,
    windowID: String,
    previousTreeVersion: String?,
    fullTree: Bool,
    persistentCapture: Bool
  ) async throws -> NativeObservedWindow {
    observation = nil
    let before = try await focusedTarget(appID: appID, windowID: windowID)
    let captureBindingKey = [
      before.identity.appID,
      before.identity.windowID,
      String(before.identity.processID),
      before.identity.executableIdentity ?? "",
      before.identity.signingIdentity ?? "",
    ].joined(separator: "|")
    let captured = try await captureObservedWindow(
      id: windowID,
      bindingKey: captureBindingKey,
      persistent: persistentCapture
    )
    let tree = accessibilityOrVisualTree(
      processID: before.processID,
      windowBounds: before.identity.windowBounds,
      captured: captured,
      previousTreeVersion: previousTreeVersion,
      fullTree: fullTree
    )
    let after: FocusedTarget
    do {
      after = try await focusedTarget(appID: appID, windowID: windowID)
      try NativeInputPolicy.validateApplicationIdentity(
        expected: before.identity, current: after.identity)
    } catch {
      await stopPersistentCapture()
      throw error
    }
    let capturedDate = Date()
    let capturedAt = ISO8601DateFormatter().string(from: capturedDate)
    var frameHasher = SHA256()
    frameHasher.update(data: captured.bytes)
    frameHasher.update(data: Data(tree.treeVersion.utf8))
    frameHasher.update(data: Data(capturedAt.utf8))
    let frameID =
      "frame-"
      + frameHasher.finalize().prefix(16).map {
        String(format: "%02x", $0)
      }.joined()
    observation = ObservationBinding(
      frameID: frameID, treeVersion: tree.treeVersion, target: before.identity,
      screenshotDigest: SHA256.hash(data: captured.bytes).map { String(format: "%02x", $0) }
        .joined())
    return NativeObservedWindow(
      frameID: frameID,
      treeVersion: tree.treeVersion,
      capturedAt: capturedAt,
      display: before.descriptor.display,
      app: before.descriptor.app,
      window: before.descriptor.window,
      snapshotID: snapshotID,
      capture: captured,
      treeMode: tree.mode,
      treeText: tree.text,
      elements: tree.elements,
      loading: false,
      sensitiveRegions: tree.sensitiveRegions
    )
  }

  func executeAction(
    _ envelope: NativeComputerActionEnvelope
  ) async throws -> NativeActionStatus {
    guard !canceledSessions.contains(envelope.computerSessionID) else {
      throw NativeHostPlatformError.sessionCanceled
    }
    guard let binding = observation else { throw NativeHostPlatformError.staleFrame }
    guard binding.frameID == envelope.observedFrameID else {
      throw NativeHostPlatformError.staleFrame
    }
    guard binding.treeVersion == envelope.observedTreeVersion else {
      throw NativeHostPlatformError.staleTree
    }
    guard binding.target.appID == envelope.targetAppID,
      binding.target.windowID == envelope.targetWindowID
    else { throw NativeHostPlatformError.focusMismatch }
    defer {
      accessibility.markDirty()
      invalidateObservation(preserveAccessibilityBaseline: true)
    }
    let before = try await focusedTarget(
      appID: envelope.targetAppID, windowID: envelope.targetWindowID)
    try NativeInputPolicy.validateApplicationIdentity(
      expected: binding.target, current: before.identity)
    userInput.bind(
      sessionID: envelope.computerSessionID, processID: before.processID,
      bounds: before.identity.windowBounds)
    if userInput.takeoverDetected(sessionID: envelope.computerSessionID) {
      throw NativeHostPlatformError.userTakeover
    }
    if envelope.executionLane == .foregroundInput {
      try await userInput.waitForUserInputIdle(sessionID: envelope.computerSessionID)
    }
    if envelope.executionLane == .foregroundInput && !before.descriptor.focused {
      _ = try focusWindow(processID: before.processID)
      try await Task.sleep(for: .milliseconds(100))
    }
    if let elementID = envelope.action.elementID,
      !accessibility.contains(
        elementID: elementID, treeVersion: envelope.observedTreeVersion)
    {
      throw NativeHostPlatformError.staleTree
    }
    if accessibility.focusedElementIsSecure(processID: before.processID) {
      switch envelope.action {
      case .typeText:
        throw NativeHostPlatformError.sensitiveInputBlocked
      case .keypress(let keys) where NativeInputPolicy.keypressCanModifySecureField(keys):
        throw NativeHostPlatformError.sensitiveInputBlocked
      default:
        break
      }
    }

    let status: NativeActionStatus
    switch envelope.action {
    case .invokeElement, .setValue, .selectText:
      guard envelope.executionLane == .backgroundSemantic else {
        throw NativeHostPlatformError.actionNotAllowed
      }
      status = try accessibility.execute(
        envelope.action, treeVersion: envelope.observedTreeVersion)
    case .click, .move, .drag, .keypress, .typeText,
      .scroll(elementID: nil, point: _, deltaX: _, deltaY: _),
      .scroll(elementID: .some, point: _, deltaX: _, deltaY: _):
      guard envelope.executionLane == .foregroundInput else {
        throw NativeHostPlatformError.actionNotAllowed
      }
      let scrollBounds: NativeRect?
      if case .scroll(let elementID?, _, _, _) = envelope.action {
        scrollBounds = try accessibility.bounds(
          elementID: elementID, treeVersion: envelope.observedTreeVersion)
      } else {
        scrollBounds = nil
      }
      status = try await MacCGEventController.execute(
        envelope.action, windowBounds: before.identity.windowBounds,
        scrollTargetBounds: scrollBounds,
        validateTarget: { [weak self] in
          guard let self else { throw NativeHostPlatformError.sessionCanceled }
          guard !(await self.canceledSessions.contains(envelope.computerSessionID)) else {
            throw NativeHostPlatformError.sessionCanceled
          }
          guard !self.userInput.takeoverDetected(sessionID: envelope.computerSessionID) else {
            throw NativeHostPlatformError.userTakeover
          }
          let current = try await self.focusedTarget(
            appID: envelope.targetAppID, windowID: envelope.targetWindowID)
          try NativeInputPolicy.validateApplicationIdentity(
            expected: binding.target, current: current.identity)
        })
    case .focusWindow(let windowID):
      guard envelope.executionLane == .foregroundInput else {
        throw NativeHostPlatformError.actionNotAllowed
      }
      guard windowID == envelope.targetWindowID else {
        throw NativeHostPlatformError.focusMismatch
      }
      status = try focusWindow(processID: before.processID)
      try await Task.sleep(for: .milliseconds(100))
    case .waitFor(let condition, let timeoutMs):
      guard envelope.executionLane == .passive else {
        throw NativeHostPlatformError.actionNotAllowed
      }
      status = try await wait(
        condition: condition, timeoutMs: timeoutMs, envelope: envelope)
    case .observe:
      guard envelope.executionLane == .passive else {
        throw NativeHostPlatformError.actionNotAllowed
      }
      status = .noop
    }

    guard !canceledSessions.contains(envelope.computerSessionID) else {
      throw NativeHostPlatformError.sessionCanceled
    }
    if actionMayChangeFocusedWindow(envelope.action) {
      // Clicks, semantic invokes, and keyboard shortcuts may intentionally open a new
      // window or switch applications. The injected-event monitor still rejects a real
      // user takeover; only the expected target identity check is relaxed after the action
      // so the broker can re-observe the newly focused window.
      guard !userInput.takeoverDetected(sessionID: envelope.computerSessionID) else {
        throw NativeHostPlatformError.userTakeover
      }
    } else {
      let after = try await focusedTarget(
        appID: envelope.targetAppID, windowID: envelope.targetWindowID)
      try NativeInputPolicy.validateApplicationIdentity(
        expected: binding.target, current: after.identity)
    }
    return status
  }

  func cancelSession(id: String) async {
    canceledSessions.insert(id)
    userInput.unbind(sessionID: id)
    invalidateObservation()
    await stopPersistentCapture()
  }

  private func captureObservedWindow(
    id: String,
    bindingKey: String,
    persistent: Bool
  ) async throws -> NativeCapturedWindow {
    guard persistent else {
      await stopPersistentCapture()
      return try await captureWindowOnce(id: id)
    }
    let requestedAt = ProcessInfo.processInfo.systemUptime
    do {
      if persistentCapture == nil || persistentCaptureBindingKey != bindingKey {
        await stopPersistentCapture()
        guard let windowID = NativeWindowIDParser.parse(id) else {
          throw NativeHostPlatformError.windowNotFound
        }
        let content = try await loadShareableContent()
        guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
          throw NativeHostPlatformError.windowNotFound
        }
        guard window.frame.width > 0, window.frame.height > 0 else {
          throw NativeHostPlatformError.invalidWindowGeometry
        }
        let scaleFactor = displayScale(for: window, displays: content.displays)
        persistentCapture = try await MacPersistentWindowCapture.start(
          window: window,
          scaleFactor: scaleFactor
        )
        persistentCaptureBindingKey = bindingKey
      }
      guard let persistentCapture else { throw NativeHostPlatformError.captureFailed }
      return try await persistentCapture.nextFrame(notBefore: requestedAt, timeout: 2)
    } catch {
      await stopPersistentCapture()
      return try await captureWindowOnce(id: id)
    }
  }

  private func stopPersistentCapture() async {
    let capture = persistentCapture
    persistentCapture = nil
    persistentCaptureBindingKey = nil
    await capture?.stop()
  }

  private func focusedTarget(appID: String, windowID: String) async throws -> FocusedTarget {
    let matches = try await listWindows().filter {
      !$0.minimized && $0.app.id == appID && $0.window.id == windowID
    }
    guard matches.count == 1, let descriptor = matches.first,
      let processID = descriptor.app.processId, processID > 0
    else { throw NativeHostPlatformError.focusMismatch }
    guard
      !NativeInputPolicy.isSensitiveTarget(
        appName: descriptor.app.name, bundleID: descriptor.app.bundleId)
    else { throw NativeHostPlatformError.sensitiveInputBlocked }
    return FocusedTarget(
      descriptor: descriptor,
      identity: NativeTargetIdentity(
        appID: descriptor.app.id,
        windowID: descriptor.window.id,
        processID: processID,
        bundleID: descriptor.app.bundleId,
        executableIdentity: descriptor.app.executableIdentity,
        signingIdentity: descriptor.app.signingIdentity,
        focused: descriptor.focused,
        windowBounds: descriptor.window.bounds
      )
    )
  }

  private func accessibilityOrVisualTree(
    processID: pid_t,
    windowBounds: NativeRect,
    captured: NativeCapturedWindow,
    previousTreeVersion: String?,
    fullTree: Bool
  ) -> NativeAXTreeSnapshot {
    if accessibility.isAvailable,
      let snapshot = try? accessibility.observe(
        processID: processID,
        preferredWindowBounds: windowBounds,
        previousTreeVersion: previousTreeVersion,
        fullTree: fullTree
      )
    {
      return snapshot
    }

    // Electron, Canvas and custom-rendered applications frequently expose no
    // usable AX window. Keep the screenshot-coordinate control path available
    // with an empty tree instead of failing the entire task.
    let digest = SHA256.hash(data: captured.bytes).prefix(16).map {
      String(format: "%02x", $0)
    }.joined()
    let version = "visual-\(digest)"
    let canDiff = !fullTree && previousTreeVersion == version
    let visualText = recognizeVisibleText(captured.bytes)
    return NativeAXTreeSnapshot(
      treeVersion: version,
      mode: canDiff ? .diff : .full,
      text: canDiff ? #"{"changed":[],"removed":[]}"# : visualText,
      elements: [],
      sensitiveRegions: []
    )
  }

  private func focusWindow(processID: pid_t) throws -> NativeActionStatus {
    guard let application = NSRunningApplication(processIdentifier: processID),
      application.activate(options: [.activateAllWindows])
    else { throw NativeHostPlatformError.actionNoop }
    let axApplication = AXUIElementCreateApplication(processID)
    if let window: AXUIElement = copyAXAttribute(axApplication, kAXFocusedWindowAttribute) {
      _ = AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    }
    return .executed
  }

  private func wait(
    condition: NativeWaitCondition,
    timeoutMs: Int,
    envelope: NativeComputerActionEnvelope
  ) async throws -> NativeActionStatus {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: .milliseconds(timeoutMs))
    while clock.now < deadline {
      guard !canceledSessions.contains(envelope.computerSessionID) else {
        throw NativeHostPlatformError.sessionCanceled
      }
      if try await conditionSatisfied(condition, envelope: envelope) { return .executed }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw NativeHostPlatformError.actionNoop
  }

  private func conditionSatisfied(
    _ condition: NativeWaitCondition,
    envelope: NativeComputerActionEnvelope
  ) async throws -> Bool {
    switch condition {
    case .loadingStopped:
      return accessibility.loadingStopped(processID: observation?.target.processID ?? 0)
    case .elementPresent(let elementID):
      return accessibility.contains(
        elementID: elementID, treeVersion: envelope.observedTreeVersion)
    case .elementAbsent(let elementID):
      return !accessibility.contains(
        elementID: elementID, treeVersion: envelope.observedTreeVersion)
    case .windowFocused(let windowID):
      guard windowID == envelope.targetWindowID else { return false }
      return try await listWindows().contains {
        $0.focused && !$0.minimized && $0.app.id == envelope.targetAppID
          && $0.window.id == envelope.targetWindowID
      }
    case .snapshotChanged(let previousFrameID):
      guard let observation else { return true }
      if observation.frameID != previousFrameID { return true }
      let current = try await captureWindow(id: envelope.targetWindowID)
      let digest = SHA256.hash(data: current.bytes).map { String(format: "%02x", $0) }.joined()
      return digest != observation.screenshotDigest
    }
  }

  private func invalidateObservation(preserveAccessibilityBaseline: Bool = false) {
    observation = nil
    if !preserveAccessibilityBaseline { accessibility.invalidate() }
  }

  private func loadShareableContent() async throws -> SCShareableContent {
    do {
      return try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false
      )
    } catch {
      if !CGPreflightScreenCaptureAccess() {
        screenPermissionWasDenied = true
        throw NativeHostPlatformError.screenPermissionDenied
      }
      throw NativeHostPlatformError.captureFailed
    }
  }

  private var captureIsSupported: Bool {
    if #available(macOS 14.0, *) { return true }
    return false
  }

  private var accessibilityPermission: String {
    if AXIsProcessTrusted() { return "granted" }
    return accessibilityPermissionWasDenied ? "denied" : "not_determined"
  }

  private var inputPermission: String {
    if CGPreflightPostEventAccess() { return "granted" }
    return inputPermissionWasDenied ? "denied" : "not_determined"
  }
}

private func actionMayChangeFocusedWindow(_ action: NativeComputerAction) -> Bool {
  switch action {
  case .click, .invokeElement, .keypress:
    return true
  default:
    return false
  }
}

private final class MacPersistentWindowCapture: NSObject, SCStreamOutput, SCStreamDelegate,
  @unchecked Sendable
{
  private let lock = NSLock()
  private let outputQueue = DispatchQueue(
    label: "com.spark-agent.desktop.computer-host.capture",
    qos: .userInitiated
  )
  private let imageContext = CIContext(options: [.cacheIntermediates: false])
  private var stream: SCStream?
  private var latest: (image: CGImage, capturedAt: TimeInterval)?
  private var terminalError = false

  static func start(window: SCWindow, scaleFactor: CGFloat) async throws
    -> MacPersistentWindowCapture
  {
    let width = max(1, min(16_384, Int((window.frame.width * scaleFactor).rounded())))
    let height = max(1, min(16_384, Int((window.frame.height * scaleFactor).rounded())))
    let configuration = SCStreamConfiguration()
    configuration.width = width
    configuration.height = height
    configuration.showsCursor = true
    if #available(macOS 14.0, *) {
      configuration.ignoreShadowsSingleWindow = false
    }
    configuration.queueDepth = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 10)
    configuration.pixelFormat = kCVPixelFormatType_32BGRA
    let capture = MacPersistentWindowCapture()
    let stream = SCStream(
      filter: SCContentFilter(desktopIndependentWindow: window),
      configuration: configuration,
      delegate: capture
    )
    try stream.addStreamOutput(capture, type: .screen, sampleHandlerQueue: capture.outputQueue)
    capture.stream = stream
    do {
      try await stream.startCapture()
      return capture
    } catch {
      capture.stream = nil
      try? await stream.stopCapture()
      throw error
    }
  }

  func nextFrame(notBefore requestedAt: TimeInterval, timeout: TimeInterval) async throws
    -> NativeCapturedWindow
  {
    let deadline = ProcessInfo.processInfo.systemUptime + timeout
    while ProcessInfo.processInfo.systemUptime < deadline {
      let state = lock.withLock { (latest, terminalError) }
      if state.1 { throw NativeHostPlatformError.captureFailed }
      if let latest = state.0, latest.capturedAt >= requestedAt {
        return NativeCapturedWindow(
          bytes: try encodePNG(latest.image),
          width: latest.image.width,
          height: latest.image.height
        )
      }
      try await Task.sleep(for: .milliseconds(25))
    }
    throw NativeHostPlatformError.captureFailed
  }

  func stop() async {
    let current = lock.withLock { () -> SCStream? in
      let current = stream
      stream = nil
      latest = nil
      return current
    }
    try? await current?.stopCapture()
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of outputType: SCStreamOutputType
  ) {
    guard outputType == .screen, sampleBuffer.isValid,
      let attachments = CMSampleBufferGetSampleAttachmentsArray(
        sampleBuffer,
        createIfNecessary: false
      ) as? [[SCStreamFrameInfo: Any]],
      let statusValue = attachments.first?[.status] as? Int,
      SCFrameStatus(rawValue: statusValue) == .complete,
      let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard let cgImage = imageContext.createCGImage(image, from: image.extent) else { return }
    lock.withLock {
      latest = (cgImage, ProcessInfo.processInfo.systemUptime)
    }
  }

  func stream(_ stream: SCStream, didStopWithError error: any Error) {
    lock.withLock {
      terminalError = true
      latest = nil
    }
  }
}

private struct ObservationBinding {
  let frameID: String
  let treeVersion: String
  let target: NativeTargetIdentity
  let screenshotDigest: String
}

private struct FocusedTarget {
  let descriptor: NativeWindowDescriptor
  let identity: NativeTargetIdentity

  var processID: pid_t { identity.processID }
}

private struct CodeIdentity {
  let identifier: String?
  let teamIdentifier: String?
}

private var hostArchitecture: String {
  #if arch(arm64)
    return "arm64"
  #elseif arch(x86_64)
    return "x64"
  #else
    return "unsupported"
  #endif
}

private func inspectCodeIdentity(processID: pid_t) -> CodeIdentity {
  let attributes = [kSecGuestAttributePid as String: NSNumber(value: processID)] as CFDictionary
  var code: SecCode?
  guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess,
    let code
  else { return CodeIdentity(identifier: nil, teamIdentifier: nil) }
  var staticCode: SecStaticCode?
  guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
    let staticCode
  else { return CodeIdentity(identifier: nil, teamIdentifier: nil) }
  guard SecStaticCodeCheckValidity(staticCode, [], nil) == errSecSuccess else {
    return CodeIdentity(identifier: nil, teamIdentifier: nil)
  }
  var information: CFDictionary?
  guard SecCodeCopySigningInformation(staticCode, [], &information) == errSecSuccess,
    let dictionary = information as? [String: Any]
  else {
    return CodeIdentity(identifier: nil, teamIdentifier: nil)
  }
  return CodeIdentity(
    identifier: dictionary[kSecCodeInfoIdentifier as String] as? String,
    teamIdentifier: dictionary[kSecCodeInfoTeamIdentifier as String] as? String
  )
}

private func frontmostWindowID() -> String? {
  let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
  guard
    let rows = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements],
      kCGNullWindowID
    ) as? [[String: Any]]
  else { return nil }
  let matching = rows.first { row in
    guard (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 else { return false }
    if let frontmostPID {
      return (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == frontmostPID
    }
    return true
  }
  guard let number = matching?[kCGWindowNumber as String] as? NSNumber else { return nil }
  return number.stringValue
}

private func displayScale(for window: SCWindow, displays: [SCDisplay]) -> CGFloat {
  let display = displays.max { left, right in
    intersectionArea(window.frame, left.frame) < intersectionArea(window.frame, right.frame)
  }
  guard let display, display.frame.width > 0 else { return 1 }
  let scale = CGFloat(display.width) / display.frame.width
  return scale.isFinite && scale > 0 && scale <= 8 ? scale : 1
}

private func intersectionArea(_ left: CGRect, _ right: CGRect) -> CGFloat {
  left.intersection(right).standardized.width * left.intersection(right).standardized.height
}

private func encodePNG(_ image: CGImage) throws -> Data {
  let data = NSMutableData()
  guard
    let destination = CGImageDestinationCreateWithData(
      data,
      UTType.png.identifier as CFString,
      1,
      nil
    )
  else { throw NativeHostPlatformError.captureFailed }
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw NativeHostPlatformError.captureFailed
  }
  return data as Data
}

private func recognizeVisibleText(_ png: Data) -> String {
  guard let source = CGImageSourceCreateWithData(png as CFData, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { return "[]" }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .fast
  request.usesLanguageCorrection = false
  request.minimumTextHeight = 0.01
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  guard (try? handler.perform([request])) != nil else { return "[]" }
  let text = (request.results ?? [])
    .compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: "\n")
  return text.isEmpty ? "[]" : String(text.prefix(200_000))
}

private func copyAXAttribute<Value>(
  _ element: AXUIElement, _ attribute: String
) -> Value? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
    let value
  else { return nil }
  return value as? Value
}
