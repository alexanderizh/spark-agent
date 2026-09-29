import Foundation

/// Decides whether a physical user interaction must abort the desktop action that
/// is currently in flight for one session.
///
/// Why this is its own value type: the previous implementation kept a sticky
/// `takeoverSessions: Set<String>` in the input monitor, so a single click or
/// keystroke inside the controlled window marked the SESSION as taken over for
/// good. Every later background action then failed with `handoff_required`
/// ("The user took control of the target window"), the model was instructed not
/// to retry, and the whole computer-use surface looked broken — even though
/// nobody had taken anything over. The interaction must only ever invalidate the
/// action it actually interrupted.
///
/// Semantics:
///  - `begin(at:)` arms a new action window and drops anything recorded earlier.
///  - `recordInteraction(at:)` notes a target-directed interaction (pointer-down
///    inside the bound window, or a keystroke while the bound app is frontmost).
///  - `detectsTakeover()` is true only when the interaction landed at or after
///    the action start, i.e. while that action was really running.
///  - A session with no armed action never detects a takeover: nothing is in
///    flight to yield, so interactions between actions (the user simply using
///    their machine) can never block the agent.
public struct NativeTakeoverWindow: Equatable, Sendable {
  private var startedAt: TimeInterval?
  private var interactionAt: TimeInterval?

  public init() {}

  /// Arms the window for a new action. Any earlier interaction is forgotten.
  public mutating func begin(at now: TimeInterval) {
    startedAt = now
    interactionAt = nil
  }

  /// Disarms the window once the action finished (success, failure, or abort) so
  /// a late interaction cannot leak into the next action's decision.
  public mutating func end() {
    startedAt = nil
    interactionAt = nil
  }

  /// Records a physical interaction that actually targeted the bound target.
  public mutating func recordInteraction(at now: TimeInterval) {
    interactionAt = now
  }

  /// True only when the user interacted while the current action was in flight.
  public func detectsTakeover() -> Bool {
    guard let startedAt, let interactionAt else { return false }
    return interactionAt >= startedAt
  }
}
