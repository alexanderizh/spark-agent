import AppKit
@preconcurrency import ApplicationServices
import Darwin
import Foundation
import SparkComputerHostCore

/// Full focus forgery: makes a background app believe it became active so it
/// accepts background (`CGEventPostToPid`) keyboard and mouse events.
///
/// The reverse-engineered Codex service posts `AXApplicationActivated` /
/// `AXFocusedWindowChanged` / `AXMainWindowChanged` to the target app before
/// delivering background input; apps that gate input handling on activation
/// ignore the raw events otherwise. We reproduce that with a strategy stack:
///
/// 1. `_AXUIElementPostNotification` — runtime SPI resolved with `dlsym`
///    (the symbol exists in HIServices on every shipping macOS but is not in
///    the public SDK headers). Posting to the app's AX element is the same
///    channel the system's own accessibility machinery uses.
/// 2. `DistributedNotificationCenter` post of the same AX notification names —
///    matches the `postNotificationName:object:userInfo:…` selector pattern
///    observed in the Codex binary; harmless when nothing observes it.
///
/// Everything here is best-effort: a failed or ignored forgery never blocks
/// the injection itself. The SPI path additionally latches off after repeated
/// failures (or immediately when `SPARK_CU_DISABLE_AX_POST=1`) so a hostile
/// runtime can never wedge the host.
enum MacFocusForger {
  /// `(element, notification, result?) -> AXError` — the classic SPI shape.
  /// Extra unused Swift-side arguments are harmless; the trailing pointer is
  /// nil in every plausible arity, so nothing dereferences garbage inputs.
  private typealias AXPostNotificationFn = @convention(c) (
    AXUIElement?, CFString, UnsafeMutableRawPointer?
  ) -> Int32

  private static let spi: AXPostNotificationFn? = resolveSPI()
  private static let disabledByEnv = ProcessInfo.processInfo.environment["SPARK_CU_DISABLE_AX_POST"] == "1"
  private static let failureBudget = LockedCounter()

  static var spiAvailable: Bool { spi != nil && !disabledByEnv && failureBudget.value < 8 }

  // MARK: - Public entry

  /// Tell `pid`'s app "you activated, this window is key and main" so it
  /// processes subsequent background input.
  static func forgeActivation(
    pid: pid_t,
    window: AXUIElement?,
    activationPoint: CGPoint?
  ) {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)

    if spiAvailable, let spi {
      var spiFailed = false
      for note in [
        kAXApplicationShownNotification as String,
        kAXApplicationActivatedNotification as String,
      ] {
        if spi(app, note as CFString, nil) != 0 { spiFailed = true }
      }
      if let window {
        for note in [
          kAXFocusedWindowChangedNotification as String,
          kAXMainWindowChangedNotification as String,
        ] {
          if spi(window, note as CFString, nil) != 0 { spiFailed = true }
        }
      }
      if spiFailed { failureBudget.increment() }
    }

    postDistributed(
      pid: pid, window: window, activationPoint: activationPoint)
  }

  /// Tell the app it went back to the background (used when we hand focus
  /// back after an action batch).
  static func forgeDeactivation(pid: pid_t) {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    if spiAvailable, let spi {
      if spi(app, kAXApplicationDeactivatedNotification as CFString, nil) != 0 {
        failureBudget.increment()
      }
    }
    DistributedNotificationCenter.default().postNotificationName(
      Notification.Name("AXApplicationDeactivated"), object: nil,
      userInfo: ["AXApplicationPID": NSNumber(value: pid)],
      deliverImmediately: true)
  }

  // MARK: - SPI resolution

  private static func resolveSPI() -> AXPostNotificationFn? {
    let symbol = "_AXUIElementPostNotification"
    let handle = dlopen(
      "/System/Library/Frameworks/ApplicationServices.framework/Frameworks/HIServices.framework/HIServices",
      RTLD_LAZY)
    defer { if let handle { dlclose(handle) } }
    for source in [handle, UnsafeMutableRawPointer(bitPattern: -2)] {
      guard let source, let raw = dlsym(source, symbol) else { continue }
      return unsafeBitCast(raw, to: AXPostNotificationFn.self)
    }
    return nil
  }

  // MARK: - Distributed notification fallback

  private static func postDistributed(
    pid: pid_t, window: AXUIElement?, activationPoint: CGPoint?
  ) {
    var userInfo: [String: Any] = ["AXApplicationPID": NSNumber(value: pid)]
    if let activationPoint {
      userInfo["AXActivationPoint"] = NSStringFromPoint(activationPoint)
    }
    DistributedNotificationCenter.default().postNotificationName(
      Notification.Name(kAXApplicationActivatedNotification as String),
      object: nil, userInfo: userInfo, deliverImmediately: true)
    DistributedNotificationCenter.default().postNotificationName(
      Notification.Name(kAXApplicationShownNotification as String),
      object: nil, userInfo: userInfo, deliverImmediately: true)
  }
}

/// Minimal thread-safe counter (the injector hops between tasks/threads).
private final class LockedCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var count = 0
  var value: Int {
    lock.lock(); defer { lock.unlock() }
    return count
  }
  func increment() {
    lock.lock(); defer { lock.unlock() }
    count += 1
  }
}
