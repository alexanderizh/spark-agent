import AppKit
import CoreGraphics
import Foundation
import SparkComputerHostCore

/// Marks CGEvents emitted by SparkComputerHost so the takeover monitor can distinguish them
/// from real user input. This value is process-local metadata; it carries no user content.
let sparkComputerInjectedEventTag: Int64 = 0x5350_4152_4B43_5553

final class MacUserInputMonitor: @unchecked Sendable {
  private let lock = NSLock()
  private var bindings: [String: UserInputBinding] = [:]
  private var takeoverSessions: Set<String> = []
  private var lastUserInputAt = Date.distantPast.timeIntervalSinceReferenceDate
  private var eventTap: CFMachPort?
  private var runLoopSource: CFRunLoopSource?
  private var thread: Thread?

  init() {
    ensureStarted()
  }

  deinit {
    stop()
  }

  var isAvailable: Bool {
    lock.withLock { eventTap != nil }
  }

  func ensureStarted() {
    guard !isAvailable else { return }
    start()
  }

  func bind(sessionID: String, processID: pid_t, bounds: NativeRect) {
    lock.withLock {
      let isNewBinding = bindings[sessionID] == nil
      bindings[sessionID] = UserInputBinding(processID: processID, bounds: bounds)
      if isNewBinding {
        takeoverSessions.remove(sessionID)
      }
    }
  }

  func unbind(sessionID: String) {
    lock.withLock {
      bindings.removeValue(forKey: sessionID)
      takeoverSessions.remove(sessionID)
    }
  }

  func takeoverDetected(sessionID: String) -> Bool {
    lock.withLock { takeoverSessions.contains(sessionID) }
  }

  func waitForUserInputIdle(
    sessionID: String,
    idleFor: Duration = .milliseconds(120),
    maximumWait: Duration = .milliseconds(350)
  ) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: maximumWait)
    let idleSeconds = durationSeconds(idleFor)
    while clock.now < deadline {
      if takeoverDetected(sessionID: sessionID) { throw NativeHostPlatformError.userTakeover }
      let lastInput = lock.withLock { lastUserInputAt }
      if Date.timeIntervalSinceReferenceDate - lastInput >= idleSeconds { return }
      try await Task.sleep(for: .milliseconds(25))
    }
    // Continuous input in another application must not cancel the bound task. Only a
    // target-window interaction recorded in `takeoverSessions` is an explicit takeover.
    if takeoverDetected(sessionID: sessionID) { throw NativeHostPlatformError.userTakeover }
  }

  private func start() {
    let monitor = self
    let mask = [
      CGEventType.leftMouseDown, .rightMouseDown, .otherMouseDown, .mouseMoved,
      .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel, .keyDown,
    ].reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    guard
      let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: mask,
        callback: { _, type, event, userInfo in
          guard let userInfo else { return Unmanaged.passUnretained(event) }
          let monitor = Unmanaged<MacUserInputMonitor>.fromOpaque(userInfo).takeUnretainedValue()
          monitor.receive(type: type, event: event)
          return Unmanaged.passUnretained(event)
        },
        userInfo: Unmanaged.passUnretained(monitor).toOpaque()
      )
    else { return }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    lock.withLock {
      eventTap = tap
      runLoopSource = source
    }
    let thread = Thread {
      monitor.runEventTapLoop()
    }
    thread.name = "SparkComputerHost.UserInputMonitor"
    self.thread = thread
    thread.start()
  }

  private func runEventTapLoop() {
    guard let state = lock.withLock({ () -> (CFMachPort, CFRunLoopSource)? in
      guard let eventTap, let runLoopSource else { return nil }
      return (eventTap, runLoopSource)
    }) else { return }
    CFRunLoopAddSource(CFRunLoopGetCurrent(), state.1, .commonModes)
    CGEvent.tapEnable(tap: state.0, enable: true)
    CFRunLoopRun()
  }

  private func stop() {
    let state = lock.withLock { () -> (CFMachPort?, CFRunLoopSource?) in
      defer {
        eventTap = nil
        runLoopSource = nil
      }
      return (eventTap, runLoopSource)
    }
    if let tap = state.0 { CGEvent.tapEnable(tap: tap, enable: false) }
    if let source = state.1 { CFRunLoopSourceInvalidate(source) }
  }

  private func receive(type: CGEventType, event: CGEvent) {
    guard event.getIntegerValueField(.eventSourceUserData) != sparkComputerInjectedEventTag else {
      return
    }
    let now = Date.timeIntervalSinceReferenceDate
    let point = event.location
    let keyboardProcessID =
      type == .keyDown ? NSWorkspace.shared.frontmostApplication?.processIdentifier : nil
    let pointerProcessID =
      type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown
      ? topmostWindowProcessID(at: point) : nil
    lock.withLock {
      lastUserInputAt = now
      if let keyboardProcessID {
        for (sessionID, binding) in bindings where binding.processID == keyboardProcessID {
          takeoverSessions.insert(sessionID)
        }
      }
      guard type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown else {
        return
      }
      guard let pointerProcessID else { return }
      for (sessionID, binding) in bindings
      where binding.processID == pointerProcessID && contains(point, in: binding.bounds)
      {
        takeoverSessions.insert(sessionID)
      }
    }
  }
}

/// Resolves the visible window that actually owns a mouse-down point. Checking only whether
/// a point falls inside the controlled window is insufficient because Spark, sheets, dialogs,
/// and other applications can overlap the same rectangle.
func topmostWindowProcessID(at point: CGPoint) -> pid_t? {
  guard
    let rawWindows = CGWindowListCopyWindowInfo(
      [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
  else { return nil }
  for window in rawWindows {
    guard let boundsDictionary = window[kCGWindowBounds as String] as? NSDictionary,
      let bounds = CGRect(dictionaryRepresentation: boundsDictionary),
      bounds.contains(point),
      let processID = window[kCGWindowOwnerPID as String] as? NSNumber
    else { continue }
    return pid_t(processID.int32Value)
  }
  return nil
}

private struct UserInputBinding {
  let processID: pid_t
  let bounds: NativeRect
}

private func contains(_ point: CGPoint, in bounds: NativeRect) -> Bool {
  point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

private func durationSeconds(_ duration: Duration) -> TimeInterval {
  let components = duration.components
  return TimeInterval(components.seconds) + TimeInterval(components.attoseconds) / 1e18
}

private extension NSLock {
  func withLock<T>(_ operation: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try operation()
  }
}
