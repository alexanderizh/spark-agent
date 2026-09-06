import Foundation

/// Cancel-current-action signal bus between the user-input monitor (physical
/// Esc) and the injection loops in the background PID channel.
///
/// Codex semantics: pressing Esc anywhere while the service is mid-action
/// cancels THAT action immediately — a long typing burst stops halfway, a
/// drag releases the button — and the caller receives the takeover error so
/// the model knows the user took over. Injection loops poll `check()` between
/// events; the monitor calls `request()` from its event-tap callback.
///
/// One logical action at a time (the broker's desktop lock guarantees
/// exclusivity), so a shared instance is sufficient. `begin()` at action start
/// both clears a stale request from a previous action and arms freshness:
/// Esc presses that arrived before the action began never cancel it.
public final class NativeInterruptionToken: @unchecked Sendable {
  public static let shared = NativeInterruptionToken()

  private let lock = NSLock()
  private var aborted = false

  public init() {}

  /// Called when an action starts. Drops any cancellation that was requested
  /// before this action existed (stale signal), so a leftover Esc press can
  /// never kill the NEXT action.
  public func begin() {
    lock.withLock { aborted = false }
  }

  /// Called by the input monitor when the user presses Esc mid-action.
  public func request() {
    lock.withLock { aborted = true }
  }

  public var isRequested: Bool {
    lock.withLock { aborted }
  }

  /// Poll point inside injection loops. Throws the takeover error so the
  /// action unwinds into the standard `handoff_required` response path.
  public func check() throws {
    if isRequested { throw NativeHostPlatformError.userTakeover }
  }
}

private extension NSLock {
  func withLock<T>(_ operation: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try operation()
  }
}
