import AppKit
import CoreGraphics
import Foundation
import SparkComputerHostCore

/// Marks CGEvents emitted by SparkComputerHost so the takeover monitor can distinguish them
/// from real user input. This value is process-local metadata; it carries no user content.
let sparkComputerInjectedEventTag: Int64 = 0x5350_4152_4B43_5553

final class MacUserInputMonitor: @unchecked Sendable {
  private let lock = NSLock()
  private var bindings: [String: NativeRect] = [:]
  private var takeoverSessions: Set<String> = []
  private var lastUserInputAt = Date.distantPast.timeIntervalSinceReferenceDate
  private var lastUserPointerDown: (at: TimeInterval, point: CGPoint)?
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

  func bind(sessionID: String, bounds: NativeRect, observedAt: TimeInterval) {
    lock.withLock {
      let isNewBinding = bindings[sessionID] == nil
      bindings[sessionID] = bounds
      if isNewBinding {
        takeoverSessions.remove(sessionID)
        if let pointerDown = lastUserPointerDown,
          pointerDown.at >= observedAt,
          contains(pointerDown.point, in: bounds)
        {
          takeoverSessions.insert(sessionID)
        }
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
    idleFor: Duration = .milliseconds(300),
    maximumWait: Duration = .seconds(5)
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
    throw NativeHostPlatformError.userTakeover
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
    lock.withLock {
      lastUserInputAt = now
      guard type == .leftMouseDown || type == .rightMouseDown || type == .otherMouseDown else {
        return
      }
      lastUserPointerDown = (at: now, point: point)
      for (sessionID, bounds) in bindings where contains(point, in: bounds) {
        takeoverSessions.insert(sessionID)
      }
    }
  }
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
