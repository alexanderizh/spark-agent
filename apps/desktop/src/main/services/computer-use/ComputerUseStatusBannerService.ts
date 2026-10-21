import { BrowserWindow, screen } from 'electron'

import { createLogger } from '@spark/shared'
import type { ComputerUseEvent } from '@spark/protocol'

import type { ComputerUsePipProjection } from './ComputerUsePipProjection.js'
import { parseComputerUsePipCommandUrl } from './ComputerUsePipService.js'
import type { ComputerUsePipSessionState } from './ComputerUsePipProjection.js'

const log = createLogger('computer-use-status-banner')

/** Window chrome height budget: a single slim pill row. */
const BANNER_HEIGHT = 32
/** Gap between the work-area top edge and the pill. */
const BANNER_TOP_INSET = 6
const BANNER_WIDTH = 320
/** A terminal session stays visible this long before the pill disappears. */
const TERMINAL_LINGER_MS = 2_500

/**
 * Top-center pill mirroring Codex's "ChatGPT is using your computer" banner:
 * while a governed computer-use session is live it tells the user who is
 * driving, what phase it is in, and that Esc hands control back. Purely
 * presentational (non-focusable, non-interactive) — commands stay on the PIP
 * panel and the kill switch. Reuses the PIP projection's fold so both surfaces
 * show the same state; this service runs its own projection instance because
 * the fold is stateful.
 */
export class ComputerUseStatusBannerService {
  private readonly projection: ComputerUsePipProjection
  private readonly unsubscribeTimeline: () => void
  private window: BrowserWindow | null = null
  private disposed = false
  private enabled: boolean
  private latestState: readonly ComputerUsePipSessionState[] = []
  private readonly retireTimers = new Set<NodeJS.Timeout>()

  constructor(options: {
    enabled?: boolean
    projection: ComputerUsePipProjection
    timeline: { subscribe(listener: (event: ComputerUseEvent) => void): () => void }
  }) {
    this.projection = options.projection
    this.enabled = options.enabled ?? true
    this.unsubscribeTimeline = options.timeline.subscribe((event) => {
      try {
        this.render(this.projection.record(event))
      } catch {
        // Best-effort: a failed fold just leaves the pill as-is.
      }
    })
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled || this.disposed) return
    this.enabled = enabled
    if (enabled) this.render(this.latestState)
    else this.closeWindow()
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeTimeline()
    for (const timer of this.retireTimers) clearTimeout(timer)
    this.retireTimers.clear()
    this.window?.destroy()
    this.window = null
  }

  private render(state: readonly ComputerUsePipSessionState[]): void {
    this.latestState = state
    if (this.disposed) return
    const top = state[state.length - 1]
    if (top == null) {
      this.closeWindow()
      return
    }
    if (top.status === 'completed' || top.status === 'stopped' || top.status === 'failed') {
      this.scheduleRetire(top.computerSessionId)
    }
    if (!this.enabled) {
      this.closeWindow()
      return
    }
    const win = this.ensureWindow()
    if (win.isDestroyed()) return
    void win.webContents
      .executeJavaScript(
        `window.__sparkBannerUpdate && window.__sparkBannerUpdate(${JSON.stringify({
          status: top.status,
          label: top.label,
        }).replace(/</g, '\\u003c')}); true`,
      )
      .catch(() => undefined)
  }

  private scheduleRetire(computerSessionId: string): void {
    // Terminal states keep the pill up briefly so the user sees the outcome,
    // mirroring the PIP panel's linger behaviour.
    const timer = setTimeout(() => {
      this.retireTimers.delete(timer)
      if (this.disposed) return
      this.render(this.projection.retire(computerSessionId))
    }, TERMINAL_LINGER_MS)
    this.retireTimers.add(timer)
  }

  private ensureWindow(): BrowserWindow {
    if (this.window != null && !this.window.isDestroyed()) return this.window
    const workArea = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
      x: workArea.x + Math.round((workArea.width - BANNER_WIDTH) / 2),
      y: workArea.y + BANNER_TOP_INSET,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    // Defense in depth: the pill page has no interactive affordances; any
    // window.open attempt rides the same private-scheme lane as the PIP and
    // is parsed (commands still honoured) but never navigates.
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const command = parseComputerUsePipCommandUrl(url)
        if (command != null) {
          log.warn('Status banner received a command URL; ignoring', { verb: command.verb })
        }
      } catch {
        // Ignore malformed attempts; the navigation is denied regardless.
      }
      return { action: 'deny' }
    })
    window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(BANNER_HTML)}`)
      .then(() => window.showInactive())
      .catch(() => undefined)
    window.on('closed', () => {
      if (this.window === window) this.window = null
    })
    this.window = window
    return window
  }

  private closeWindow(): void {
    if (this.window == null || this.window.isDestroyed()) return
    this.window.destroy()
    this.window = null
  }
}

export const BANNER_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; font-family: -apple-system, "PingFang SC", sans-serif; }
  #pill {
    height: 26px; margin: 3px 6px; padding: 0 12px; box-sizing: border-box;
    display: flex; align-items: center; gap: 7px; border-radius: 13px;
    background: rgba(28, 28, 32, 0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    color: #e8e8ec; font-size: 11px; line-height: 1;
    user-select: none; white-space: nowrap; overflow: hidden;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .text { overflow: hidden; text-overflow: ellipsis; }
  .hint { color: rgba(255,255,255,0.45); flex: none; }
  .accent-running { background: #4c8dff; box-shadow: 0 0 8px #4c8dff88; }
  .accent-acting { background: #ffb340; box-shadow: 0 0 8px #ffb34088; }
  .accent-awaiting_approval { background: #ff6b6b; box-shadow: 0 0 8px #ff6b6b88; }
  .accent-failed { background: #ff5252; }
  .accent-completed { background: #38c979; }
  .accent-stopped { background: #9a9aa2; }
</style>
</head>
<body>
<div id="pill">
  <span class="dot accent-running" id="dot"></span>
  <span class="text" id="text">Spark 正在操作此电脑</span>
  <span class="hint">Esc 打断</span>
</div>
<script>
  var STATE_LABELS = {
    running: 'Spark 正在操作此电脑', acting: 'Spark 正在执行操作', failed: 'Spark 操作失败',
    awaiting_approval: 'Spark 等待你的确认', completed: 'Spark 任务已完成', stopped: 'Spark 已停止'
  };
  window.__sparkBannerUpdate = function (state) {
    document.getElementById('dot').className = 'dot accent-' + state.status;
    document.getElementById('text').textContent = (STATE_LABELS[state.status] || 'Spark 正在操作此电脑') + (state.label ? ' · ' + state.label : '');
  };
</script>
</body>
</html>`
