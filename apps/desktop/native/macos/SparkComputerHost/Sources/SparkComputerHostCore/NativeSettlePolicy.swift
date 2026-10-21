import Foundation

/// Decides when the UI has stopped reacting to an injected action.
///
/// Mirrors the Codex computer-use settle loop: after an action the interface
/// often keeps mutating for a few hundred milliseconds (spinner appears,
/// results stream in, layout shifts). Returning a screenshot/tree mid-churn
/// produces observations the model cannot reason about. The policy waits for a
/// *quiet window* — a stretch with no AX change notifications and no busy
/// indicator — bounded by a hard cap so a continuously-animated app cannot
/// stall the action response.
///
/// Pure stateless decision function so the IO wrapper stays trivial and the
/// thresholds stay unit-testable.
public enum NativeSettlePolicy {
  public enum Decision: Equatable, Sendable {
    case keepWaiting
    case settled
  }

  public static let defaultBaselineMs = 200
  public static let defaultQuietMs = 300
  public static let defaultMaxMs = 1_500

  /// Semantic lane (background AX invoke/set_value/...): the AX call is
  /// atomic — by the time it returns, the state change already happened, so
  /// only the app's own rendering pass is left to wait for. The injected-event
  /// lanes keep the full budget (their effects propagate through the event
  /// queue and can trigger follow-on focus/layout churn).
  public static let semanticBaselineMs = 110
  public static let semanticQuietMs = 160

  public static func decide(
    elapsedMs: Int,
    msSinceLastChange: Int,
    busy: Bool,
    baselineMs: Int = defaultBaselineMs,
    quietMs: Int = defaultQuietMs,
    maxMs: Int = defaultMaxMs
  ) -> Decision {
    // Hard cap first: a spinning/animated app must not stall the pipeline.
    if elapsedMs >= maxMs { return .settled }
    // Give the action's immediate effects (window switch, first layout pass)
    // time to land before quiet-window counting starts.
    if elapsedMs < baselineMs { return .keepWaiting }
    if busy { return .keepWaiting }
    return msSinceLastChange >= quietMs ? .settled : .keepWaiting
  }
}
