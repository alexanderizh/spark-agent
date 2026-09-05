import AppKit
import CoreGraphics
import Foundation

/// Agent-visible virtual cursor: a transparent always-on-top overlay window
/// that draws where the agent is about to act, mirroring the reverse-
/// engineered Codex `ComputerUseCursor` (jelly-scale move animation, press
/// feedback on click, idle fade-out).
///
/// The overlay never intercepts input (`ignoresMouseEvents`) and the host
/// process uses a `.prohibited` activation policy, so showing this cursor
/// never activates the host or steals focus from any app. All public calls
/// are fire-and-forget from any thread/queue: visual feedback must never
/// block or fail an action, and without a running AppKit loop (tests,
/// headless CI) every call is a harmless no-op.
enum MacVirtualCursor {
  /// Move the cursor to a CGGlobalPoint (top-left origin) and show it.
  static func move(to point: CGPoint) {
    state?.move(to: point)
  }

  /// Press feedback — call on mouse down.
  static func pressDown() {
    state?.pressDown()
  }

  /// Release feedback — call on mouse up; overshoots slightly back to 1.
  static func pressUp() {
    state?.pressUp()
  }

  /// Drag path — reposition along the interpolated CGGlobalPoints.
  static func drag(to point: CGPoint) {
    state?.drag(to: point)
  }

  static func hide() {
    state?.hide()
  }

  /// Nil until the AppKit run loop is alive (host main bootstrap).
  private static let state: CursorState? = CursorState()

  /// Ties the lifecycle to AppKit availability: constructing on a machine
  /// without a window server would trap, so creation is lazy-safe via `nil`.
  private final class CursorState: @unchecked Sendable {
    private let queue = DispatchQueue.main
    private var panel: NSPanel?
    private var cursorLayer: CALayer?
    private var fadeWorkItem: DispatchWorkItem?

    private let moveDuration: CFTimeInterval = 0.12
    private let pressDuration: CFTimeInterval = 0.08
    private let idleFadeDelay: TimeInterval = 1.2
    private let idleFadeDuration: CFTimeInterval = 0.5
    private let cursorSize: CGFloat = 26

    func move(to cgPoint: CGPoint) {
      queue.async { [self] in performMove(to: cgPoint) }
    }

    private func performMove(to cgPoint: CGPoint) {
      let layer = ensureLayer()
      let point = fromCG(cgPoint)
      ensurePanel(contains: point)
      cancelFade(layer)
      CATransaction.begin()
      CATransaction.setAnimationDuration(moveDuration)
      CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeInEaseOut))
      layer.position = localPoint(for: point)
      layer.opacity = 1
      CATransaction.commit()
      // Jelly bounce on arrival, started after the move animation window
      // (CATransaction completion blocks trip a compiler bug on this SDK).
      queue.asyncAfter(deadline: .now() + moveDuration + 0.01) { [weak self] in
        self?.jellyBounce(layer)
      }
      scheduleFade()
    }

    func pressDown() {
      queue.async { [self] in performPressDown() }
    }

    private func performPressDown() {
      guard let layer = cursorLayer else { return }
      cancelFade(layer)
      CATransaction.begin()
      CATransaction.setAnimationDuration(pressDuration)
      layer.transform = CATransform3DMakeScale(0.82, 0.82, 1)
      CATransaction.commit()
    }

    func pressUp() {
      queue.async { [self] in performPressUp() }
    }

    private func performPressUp() {
      guard let layer = cursorLayer else { return }
      let animation = CAKeyframeAnimation(keyPath: "transform.scale")
      animation.values = [0.82, 1.08, 1.0]
      animation.keyTimes = [0, 0.6, 1]
      animation.duration = 0.18
      layer.add(animation, forKey: "release")
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      layer.transform = CATransform3DIdentity
      CATransaction.commit()
      scheduleFade()
    }

    func drag(to cgPoint: CGPoint) {
      queue.async { [self] in performDrag(to: cgPoint) }
    }

    private func performDrag(to cgPoint: CGPoint) {
      guard let layer = cursorLayer else { return }
      let point = fromCG(cgPoint)
      ensurePanel(contains: point)
      cancelFade(layer)
      CATransaction.begin()
      CATransaction.setAnimationDuration(moveDuration)
      layer.position = localPoint(for: point)
      CATransaction.commit()
    }

    func hide() {
      queue.async { [self] in performHide() }
    }

    private func performHide() {
      guard let layer = cursorLayer else { return }
      cancelFade(layer)
      CATransaction.begin()
      CATransaction.setAnimationDuration(idleFadeDuration)
      layer.opacity = 0
      CATransaction.commit()
    }

    // MARK: - Setup

    /// CGGlobalPoint (y down from top of primary) → AppKit global (y up from
    /// bottom of primary).
    private func fromCG(_ point: CGPoint) -> CGPoint {
      let primaryMaxY = NSScreen.screens.first?.frame.maxY ?? 0
      return CGPoint(x: point.x, y: primaryMaxY - point.y)
    }

    private func ensureLayer() -> CALayer {
      if let cursorLayer { return cursorLayer }
      let layer = CALayer()
      layer.frame = CGRect(x: 0, y: 0, width: cursorSize, height: cursorSize)
      layer.contents = CursorArtwork.image(size: cursorSize)
      layer.contentsGravity = .resizeAspect
      layer.shadowColor = NSColor.black.cgColor
      layer.shadowOpacity = 0.35
      layer.shadowRadius = 3
      layer.shadowOffset = CGSize(width: 1, height: -1)
      cursorLayer = layer
      return layer
    }

    private func ensurePanel(contains appKitPoint: CGPoint) {
      let screen = NSScreen.screens.first { NSPointInRect(appKitPoint, $0.frame) }
        ?? NSScreen.main
      guard let screen else { return }
      if let panel, panel.frame == screen.frame, panel.contentView is CursorHostView {
        return
      }
      panel?.orderOut(nil)
      let panel = NSPanel(
        contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
      panel.isOpaque = false
      panel.backgroundColor = .clear
      panel.level = NSWindow.Level(rawValue: 25)
      panel.ignoresMouseEvents = true
      panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
      panel.hasShadow = false
      panel.contentView = CursorHostView(
        frame: NSRect(origin: .zero, size: screen.frame.size))
      panel.orderFrontRegardless()
      self.panel = panel
      if let cursorLayer, let host = panel.contentView as? CursorHostView {
        host.layer?.addSublayer(cursorLayer)
      }
    }

    private func localPoint(for appKitPoint: CGPoint) -> CGPoint {
      guard let panelFrame = panel?.frame else { return appKitPoint }
      return CGPoint(
        x: appKitPoint.x - panelFrame.minX,
        y: appKitPoint.y - panelFrame.minY)
    }

    // MARK: - Animations

    private func jellyBounce(_ layer: CALayer) {
      let animation = CAKeyframeAnimation(keyPath: "transform.scale")
      animation.values = [0.9, 1.14, 1.0]
      animation.keyTimes = [0, 0.55, 1]
      animation.duration = 0.2
      layer.add(animation, forKey: "jelly")
    }

    private func scheduleFade() {
      fadeWorkItem?.cancel()
      let work = DispatchWorkItem { [weak self] in self?.hide() }
      fadeWorkItem = work
      queue.asyncAfter(deadline: .now() + idleFadeDelay, execute: work)
    }

    private func cancelFade(_ layer: CALayer) {
      fadeWorkItem?.cancel()
      fadeWorkItem = nil
      if layer.opacity < 1 {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.opacity = 1
        CATransaction.commit()
      }
    }
  }
}

/// Layer-hosting view that never becomes first responder or takes events.
private final class CursorHostView: NSView {
  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
  }

  required init?(coder: NSCoder) { nil }
}

/// Arrow artwork: white stroke + accent fill, drawn once and cached.
private enum CursorArtwork {
  private static let lock = NSLock()
  private nonisolated(unsafe) static var cache: CGImage?

  static func image(size: CGFloat) -> CGImage? {
    lock.lock()
    if let cache {
      lock.unlock()
      return cache
    }
    lock.unlock()

    let dimension = Int(size.rounded())
    guard dimension > 0 else { return nil }
    let image = NSImage(size: NSSize(width: dimension, height: dimension))
    image.lockFocus()
    let path = NSBezierPath()
    path.move(to: NSPoint(x: 2, y: 2))
    path.line(to: NSPoint(x: 2, y: size - 6))
    path.curve(
      to: NSPoint(x: 8, y: size - 12),
      controlPoint1: NSPoint(x: 2.5, y: size - 10),
      controlPoint2: NSPoint(x: 4.5, y: size - 11.5))
    path.line(to: NSPoint(x: 6.5, y: size - 12))
    path.curve(
      to: NSPoint(x: 7.5, y: size - 8.5),
      controlPoint1: NSPoint(x: 9.5, y: size - 11.5),
      controlPoint2: NSPoint(x: 10, y: size - 9.5))
    path.line(to: NSPoint(x: 9, y: size - 9.5))
    path.curve(
      to: NSPoint(x: 10, y: size - 6),
      controlPoint1: NSPoint(x: 11.5, y: size - 8.5),
      controlPoint2: NSPoint(x: 12, y: size - 7))
    path.close()
    NSColor.white.setStroke()
    path.lineWidth = 2.4
    path.stroke()
    NSColor.controlAccentColor.setFill()
    path.fill()
    image.unlockFocus()

    let rendered = image.cgImage(
      forProposedRect: nil, context: nil, hints: nil)
    lock.lock()
    cache = rendered
    lock.unlock()
    return rendered
  }
}
