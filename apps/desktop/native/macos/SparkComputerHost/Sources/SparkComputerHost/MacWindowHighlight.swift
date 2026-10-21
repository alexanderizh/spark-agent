import AppKit
import CoreGraphics
import Foundation
import os

/// Target-window highlight: an always-on-top borderless overlay that traces
/// the governed session's target window with an accent ring and a small
/// "Spark" badge, so the user can see at a glance which window the agent is
/// driving. This persistent window marker works independently of per-action
/// cursor feedback.
///
/// Same ground rules as `MacVirtualCursor`: the overlay never intercepts
/// input (`ignoresMouseEvents`), never activates the host (`.prohibited`
/// activation policy), and every call is fire-and-forget from any thread.
/// Without a running AppKit loop (tests, headless CI) all calls are no-ops.
/// Frame tracking polls the on-screen window list (cheap CG call, immune to a
/// hung target app) instead of AX notifications, and the overlay hides itself
/// when the window leaves the screen or the session goes idle.
enum MacWindowHighlight {
  /// Master switch (the client's windowHighlightIndicator flag, carried per
  /// execute_action request). Guarded: requests decode off-main while overlay
  /// calls hop to the main queue.
  private static let enabledFlag = OSAllocatedUnfairLock(initialState: true)

  /// False hides the overlay and stops tracking (actions are unaffected —
  /// only the window identification disappears).
  static func setEnabled(_ value: Bool) {
    enabledFlag.withLock { $0 = value }
    if !value { hide() }
  }

  static func isEnabled() -> Bool {
    enabledFlag.withLock { $0 }
  }

  /// Point the highlight at a window (CGWindowID) and keep following it until
  /// hidden, the window disappears, or the idle timeout lapses.
  static func show(cgWindowID: CGWindowID) {
    guard isEnabled() else { return }
    state?.show(cgWindowID: cgWindowID)
  }

  static func hide() {
    state?.hide()
  }

  /// Nil until the AppKit run loop is alive (host main bootstrap).
  private static let state: HighlightState? = HighlightState()

  private final class HighlightState: @unchecked Sendable {
    private let queue = DispatchQueue.main
    private var panel: NSPanel?
    private var ringLayer: CAShapeLayer?
    private var badgeLayer: CATextLayer?
    private var trackTimer: Timer?
    private var trackedWindowID: CGWindowID?
    /// The window the reveal animation last played for: switching targets
    /// replays it, repeated actions on the same window must not.
    private var revealedWindowID: CGWindowID?
    private var idleWorkItem: DispatchWorkItem?

    private let followInterval: TimeInterval = 0.05
    private let ringInset: CGFloat = 3
    private let cornerRadius: CGFloat = 10
    private let badgeFontSize: CGFloat = 12
    private let idleHideDelay: TimeInterval = 6

    func show(cgWindowID: CGWindowID) {
      queue.async { [self] in performShow(cgWindowID: cgWindowID) }
    }

    private func performShow(cgWindowID: CGWindowID) {
      guard let frame = Self.windowFrame(cgWindowID: cgWindowID) else { return }
      trackedWindowID = cgWindowID
      let isNewTarget = revealedWindowID != cgWindowID
      revealedWindowID = cgWindowID
      // A show landing while the previous fade-out completion is still pending
      // must cancel it, or the panel vanishes right after being re-shown.
      panel?.animator().alphaValue = 1
      panel?.alphaValue = 1
      let view = ensureOverlay(frame: frame)
      layoutOverlay(view: view, frame: frame, animateIn: isNewTarget)
      panel?.orderFrontRegardless()
      startTracking()
      scheduleIdleHide()
    }

    func hide() {
      queue.async { [self] in performHide() }
    }

    private func performHide() {
      trackedWindowID = nil
      stopTracking()
      idleWorkItem?.cancel()
      idleWorkItem = nil
      guard let panel else { return }
      // Fade out before teardown so hiding never reads as a visual glitch.
      NSAnimationContext.runAnimationGroup({ context in
        context.duration = 0.18
        panel.animator().alphaValue = 0
      }, completionHandler: { [weak panel] in
        panel?.orderOut(nil)
        panel?.alphaValue = 1
      })
      // The next show (possibly minutes later) is a fresh reveal.
      revealedWindowID = nil
    }

    // MARK: - Overlay lifecycle

    private func ensureOverlay(frame: CGRect) -> HighlightHostView {
      if let panel, let host = panel.contentView as? HighlightHostView {
        panel.setFrame(frame.insetBy(dx: -ringInset, dy: -ringInset), display: false)
        return host
      }
      let panel = NSPanel(
        contentRect: frame.insetBy(dx: -ringInset, dy: -ringInset),
        styleMask: [.borderless], backing: .buffered, defer: false)
      panel.isOpaque = false
      panel.backgroundColor = .clear
      // Keep the established overlay level while the cursor layer is disabled.
      panel.level = NSWindow.Level(rawValue: 24)
      panel.ignoresMouseEvents = true
      panel.collectionBehavior = [
        .canJoinAllSpaces, .fullScreenAuxiliary, .stationary,
      ]
      panel.hasShadow = false
      panel.hidesOnDeactivate = false
      let host = HighlightHostView(
        frame: NSRect(origin: .zero, size: panel.contentRect(forFrameRect: panel.frame).size))
      panel.contentView = host
      panel.orderFrontRegardless()
      self.panel = panel
      return host
    }

    private func layoutOverlay(view: HighlightHostView, frame: CGRect, animateIn: Bool) {
      guard let panel else { return }
      let outer = frame.insetBy(dx: -ringInset, dy: -ringInset)
      panel.setFrame(outer, display: false)
      view.setFrameSize(NSSize(width: outer.width, height: outer.height))
      view.layoutRing(
        cornerRadius: cornerRadius, badgeFontSize: badgeFontSize, animateIn: animateIn)
    }

    // MARK: - Frame tracking

    private func startTracking() {
      if trackTimer != nil { return }
      let timer = Timer(timeInterval: followInterval, repeats: true) { [weak self] _ in
        self?.syncFrame()
      }
      RunLoop.main.add(timer, forMode: .common)
      trackTimer = timer
    }

    private func stopTracking() {
      trackTimer?.invalidate()
      trackTimer = nil
    }

    private func syncFrame() {
      guard let windowID = trackedWindowID else { return }
      guard let frame = Self.windowFrame(cgWindowID: windowID) else {
        // Window closed / left the screen: tracking is pointless.
        performHide()
        return
      }
      guard let panel, let host = panel.contentView as? HighlightHostView else { return }
      let outer = frame.insetBy(dx: -ringInset, dy: -ringInset)
      guard panel.frame != outer else { return }
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      panel.setFrame(outer, display: false)
      host.setFrameSize(NSSize(width: outer.width, height: outer.height))
      host.layoutRing(
        cornerRadius: cornerRadius, badgeFontSize: badgeFontSize, animateIn: false)
      CATransaction.commit()
    }

    private func scheduleIdleHide() {
      idleWorkItem?.cancel()
      let work = DispatchWorkItem { [weak self] in self?.performHide() }
      idleWorkItem = work
      queue.asyncAfter(deadline: .now() + idleHideDelay, execute: work)
    }

    /// On-screen bounds for a window id in AppKit coordinates. Returns nil for
    /// minimized / off-screen / closed windows.
    static func windowFrame(cgWindowID: CGWindowID) -> CGRect? {
      guard
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], cgWindowID)
          as? [[String: Any]],
        let info = list.first
      else { return nil }
      guard let boundsDict = info[kCGWindowBounds as String] as? [String: NSNumber] else {
        return nil
      }
      let cgFrame = CGRect(
        x: boundsDict["X"]?.doubleValue ?? 0,
        y: boundsDict["Y"]?.doubleValue ?? 0,
        width: boundsDict["Width"]?.doubleValue ?? 0,
        height: boundsDict["Height"]?.doubleValue ?? 0)
      guard cgFrame.width > 8, cgFrame.height > 8 else { return nil }
      let primaryMaxY = NSScreen.screens.first?.frame.maxY ?? 0
      return CGRect(
        x: cgFrame.minX, y: primaryMaxY - cgFrame.maxY,
        width: cgFrame.width, height: cgFrame.height)
    }
  }

  /// Layer-hosting view that never becomes first responder or takes events.
  private final class HighlightHostView: NSView {
    override init(frame frameRect: NSRect) {
      super.init(frame: frameRect)
      wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }

    func layoutRing(cornerRadius: CGFloat, badgeFontSize: CGFloat, animateIn: Bool) {
      guard let container = layer else { return }
      let bounds = CGRect(origin: .zero, size: frame.size)

      let ring: CAShapeLayer
      if let existing = container.sublayers?.first(where: { $0 is CAShapeLayer })
        as? CAShapeLayer
      {
        ring = existing
      } else {
        ring = CAShapeLayer()
        ring.strokeColor = NSColor.controlAccentColor.withAlphaComponent(0.9).cgColor
        ring.fillColor = NSColor.clear.cgColor
        ring.lineWidth = 2.5
        ring.shadowColor = NSColor.controlAccentColor.cgColor
        ring.shadowOpacity = 0.45
        ring.shadowRadius = 7
        ring.shadowOffset = .zero
        container.addSublayer(ring)
      }
      // Rounded rect built directly as a CGPath (NSBezierPath.cgPath needs
      // macOS 14). The shape is axis-symmetric, so layer-axis interpretation
      // differences cannot distort it.
      ring.path = CGPath(
        roundedRect: bounds.insetBy(dx: 1.25, dy: 1.25),
        cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)
      ring.frame = bounds

      let badge: CATextLayer
      if let existing = container.sublayers?.first(where: { $0 is CATextLayer })
        as? CATextLayer
      {
        badge = existing
      } else {
        badge = CATextLayer()
        badge.string = "Spark"
        badge.font = NSFont.systemFont(ofSize: badgeFontSize, weight: .semibold)
        badge.fontSize = badgeFontSize
        badge.foregroundColor = NSColor.white.cgColor
        badge.backgroundColor = NSColor.controlAccentColor.cgColor
        badge.alignmentMode = .center
        badge.contentsScale = NSScreen.main?.backingScaleFactor ?? 2
        badge.cornerRadius = 8
        badge.masksToBounds = true
        container.addSublayer(badge)
      }
      let badgeWidth = badgeFontSize * 4.6
      let badgeHeight = badgeFontSize * 1.7
      let badgeOrigin = CGPoint(x: 12, y: bounds.maxY - badgeHeight - 8)
      badge.frame = CGRect(
        origin: badgeOrigin, size: CGSize(width: badgeWidth, height: badgeHeight))

      if animateIn {
        let reveal = CABasicAnimation(keyPath: "strokeEnd")
        reveal.fromValue = 0
        reveal.toValue = 1
        reveal.duration = 0.32
        reveal.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ring.add(reveal, forKey: "reveal")
      }
    }
  }
}
