import Foundation

/// Readiness of a Chromium-derived web-content tree.
///
/// Chromium (Chrome, Edge, every Electron app) does not build an accessibility
/// tree until an assistive client asks for one. Setting `AXManualAccessibility`
/// on the application element starts that work — but **asynchronously**: the
/// next traversal can still return only the native window shell (title bar
/// buttons), because the renderer has to assemble the tree and publish it over
/// IPC, and a backgrounded renderer is throttled while it does.
///
/// Measured on this machine (2026-09-30, `get_app_state`-equivalent traversal):
///
/// | app state | first traversal | after the tree was built |
/// | --- | --- | --- |
/// | freshly launched Electron (renderer hot) | ready, 174 ms, 400 nodes | — |
/// | long-idle Electron (renderer throttled) | 9-10 nodes, no `AXWebArea`, for ~2.3 s | 503 nodes / 24k chars of outline |
/// | native AppKit app (Finder) | handshake rejected (`AXError.attributeUnsupported`) | — |
///
/// So "the app answered but the tree is only the window shell" is a *timing*
/// signal, not a property of the app. Publishing it as final is exactly what
/// made Electron targets look empty — and because the result was cached, the
/// next observation kept serving the same shell.
public enum NativeWebTreeReadiness {
  /// Role Chromium gives the document container. The rendered outline shows the
  /// app's localized `AXRoleDescription` ("HTML content" / "HTML 内容"), so
  /// readiness must be decided on the raw role, never on the rendered word.
  public static let webContentRole = "AXWebArea"

  /// Delays before each extra traversal, in milliseconds. The first extra pass
  /// is nearly free (the attribute flip has just landed) and the tail is long
  /// enough for a throttled renderer to answer. Total added wait is ~4.7 s:
  /// the measured throttled-renderer convergence was ~2.3 s, and the previous
  /// ~1.75 s budget lost that race by half a second — the first traversal then
  /// published (and cached) the window shell, which is exactly how Electron
  /// targets ended up looking permanently empty.
  public static let retryDelaysMs: [Int] = [120, 240, 480, 900, 1_500, 1_500]

  /// How long a window that exhausted the retry schedule is served without
  /// waiting again. The exhaustion record is a COOLDOWN, not a blacklist: a
  /// genuinely shell-only window (Electron tray popups, helper windows) still
  /// must not cost the full schedule on every observation, but a later
  /// observation is allowed to re-arm the wait — the tree may simply have been
  /// slow once. A permanent blacklist turned one mistimed first traversal into
  /// a whole session of shell-only observations.
  public static let exhaustedWindowCooldownSeconds: TimeInterval = 15

  /// A tree this small that also has no web content is an unfinished build
  /// rather than a genuinely tiny window: the window shell alone (frame, title
  /// bar, three traffic-light buttons) already accounts for a handful of nodes,
  /// while any real Chromium page exceeds this by an order of magnitude.
  public static let shellElementBudget = 60

  /// True when the traversal found a document container that actually has
  /// content beneath it. An empty `AXWebArea` (measured: a 1x1 group on a
  /// half-loaded page) does not count — that is the tree mid-build.
  public static func hasWebContent(_ elements: [NativeAXRawElement]) -> Bool {
    for (index, element) in elements.enumerated() where element.role == webContentRole {
      if elements[(index + 1)...].contains(where: { $0.depth > element.depth }) {
        return true
      }
    }
    return false
  }

  /// Whether another traversal is worth paying for.
  ///
  /// - Parameters:
  ///   - acceptsManualAccessibility: the application answered the Chromium
  ///     handshake (`AXManualAccessibility` set succeeded). Native AppKit apps
  ///     reject the attribute, so this is a precise "this app builds its tree
  ///     lazily" flag rather than a guess from the bundle identifier.
  ///   - attempts: extra traversals already performed.
  ///   - webTreeSeenForProcess: a web-content tree has been read for this
  ///     process at least once. Once Chromium has built the tree it keeps it,
  ///     so a later shell-only read means a genuinely different (empty or
  ///     helper) window and must not be retried.
  public static func shouldRetry(
    acceptsManualAccessibility: Bool,
    elements: [NativeAXRawElement],
    attempts: Int,
    webTreeSeenForProcess: Bool
  ) -> Bool {
    guard acceptsManualAccessibility, !webTreeSeenForProcess else { return false }
    guard !hasWebContent(elements) else { return false }
    guard elements.count <= shellElementBudget else { return false }
    return attempts < retryDelaysMs.count
  }

  /// One-line marker prepended to an unfinished tree, so neither the model nor a
  /// log reader mistakes the window shell for the whole interface.
  public static let pendingNotice =
    "[accessibility: this Chromium app is still building its web-content tree — only the window shell is shown; observe again in a moment]"
}
