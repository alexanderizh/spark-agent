import { BrowserWindow, screen } from 'electron'

import type { ComputerUseEvent } from '@spark/protocol'
import { createLogger } from '@spark/shared'

import { ComputerUsePipProjection } from './ComputerUsePipProjection.js'
import type { ComputerUseTimelineStore } from './ComputerUseTimelineStore.js'

const log = createLogger('computer-use-pip')

/**
 * Remote-hosted PIP-style live panel: a small always-on-top, non-focusable
 * window showing what the agent is doing on the desktop right now — target
 * app, latest action summary, and a status accent. Mirrors the reverse-
 * engineered Codex RemoteHostedPIP surface, hosted by the app (not the
 * native service) because all live state (timeline events, sessions) lives
 * here. Every window/OS interaction is best-effort: the PIP must never
 * influence task execution.
 */
export class ComputerUsePipService {
  private readonly timeline: ComputerUseTimelineStore
  private readonly projection: ComputerUsePipProjection
  private readonly unsubscribeTimeline: () => void
  private window: BrowserWindow | null = null
  private disposed = false
  /** Terminal sessions linger briefly so the user sees the final status. */
  private readonly retireTimers = new Set<NodeJS.Timeout>()

  constructor(options: {
    timeline: ComputerUseTimelineStore
    projection: ComputerUsePipProjection
    /** How long a terminal status stays on screen before the panel closes. */
    terminalLingerMs?: number
  }) {
    this.timeline = options.timeline
    this.projection = options.projection
    this.terminalLingerMs = options.terminalLingerMs ?? 2_500
    this.unsubscribeTimeline = this.timeline.subscribe((event) => {
      try {
        this.render(this.projection.record(event))
        if (isTerminalComputerUseEvent(event)) this.scheduleRetire(event.computerSessionId)
      } catch (error) {
        log.warn('PIP projection failed', { error: stringify(error) })
      }
    })
  }

  private readonly terminalLingerMs: number
  private scheduleRetire(computerSessionId: string): void {
    const timer = setTimeout(() => {
      this.retireTimers.delete(timer)
      if (this.disposed) return
      try {
        this.render(this.projection.retire(computerSessionId))
      } catch {
        // Best-effort: a failed retire just leaves the panel up until the
        // next session lifecycle event re-renders it.
      }
    }, this.terminalLingerMs)
    this.retireTimers.add(timer)
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribeTimeline()
    for (const timer of this.retireTimers) clearTimeout(timer)
    this.retireTimers.clear()
    this.window?.destroy()
    this.window = null
  }

  private render(state: ComputerUsePipProjectionReturnType): void {
    if (this.disposed) return
    if (state.length === 0) {
      this.closeWindow()
      return
    }
    const win = this.ensureWindow()
    if (win.isDestroyed()) return
    const payload = JSON.stringify(state).replace(/</g, '\\u003c')
    void win.webContents
      .executeJavaScript(`window.__sparkPipUpdate && window.__sparkPipUpdate(${payload}); true`)
      .catch(() => undefined)
  }

  private ensureWindow(): BrowserWindow {
    if (this.window != null && !this.window.isDestroyed()) return this.window
    const workArea = screen.getPrimaryDisplay().workArea
    const width = 300
    const height = 108
    const window = new BrowserWindow({
      width,
      height,
      x: workArea.x + workArea.width - width - 16,
      y: workArea.y + workArea.height - height - 16,
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
    window
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PIP_HTML)}`)
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

type ComputerUsePipProjectionReturnType = ReturnType<ComputerUsePipProjection['snapshot']>

function isTerminalComputerUseEvent(event: ComputerUseEvent): boolean {
  return (
    event.type === 'computer_session_completed' ||
    event.type === 'computer_session_failed' ||
    event.type === 'computer_session_canceled'
  )
}

function stringify(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The panel body: pure inline HTML/CSS/JS, no external assets. Dark card on
 * any desktop; updates arrive via `__sparkPipUpdate(stateArray)`.
 */
const PIP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; font-family: -apple-system, "PingFang SC", sans-serif; }
  body { display: flex; align-items: stretch; justify-content: flex-end; }
  #card {
    width: 292px; box-sizing: border-box; padding: 10px 12px;
    border-radius: 12px;
    background: rgba(28, 28, 32, 0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e8e8ec;
  }
  .head { display: flex; align-items: center; gap: 7px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .title { font-size: 12px; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .state { font-size: 10px; color: rgba(255,255,255,0.55); flex: none; }
  .action { margin-top: 6px; font-size: 11px; line-height: 1.45; color: rgba(255,255,255,0.82);
    min-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .action.empty { color: rgba(255,255,255,0.4); }
  .spark { font-size: 9px; letter-spacing: 0.4px; color: rgba(255,255,255,0.35); margin-top: 5px; }
  .accent-running { background: #4c8dff; box-shadow: 0 0 8px #4c8dff88; }
  .accent-acting { background: #ffb340; box-shadow: 0 0 8px #ffb34088; }
  .accent-awaiting_approval { background: #ff6b6b; box-shadow: 0 0 8px #ff6b6b88; }
  .accent-failed { background: #ff5252; }
  .accent-completed { background: #38c979; }
  .accent-stopped { background: #9a9aa2; }
</style>
</head>
<body>
<div id="card">
  <div class="head">
    <span class="dot accent-running" id="dot"></span>
    <span class="title" id="title">Spark 电脑操作</span>
    <span class="state" id="state"></span>
  </div>
  <div class="action empty" id="action">准备中…</div>
  <div class="spark">SPARKWORK · COMPUTER USE</div>
</div>
<script>
  var STATE_LABELS = {
    running: '观察中', acting: '执行中', failed: '失败',
    awaiting_approval: '等待确认', completed: '已完成', stopped: '已停止'
  };
  window.__sparkPipUpdate = function (sessions) {
    var top = sessions[sessions.length - 1];
    if (!top) return;
    document.getElementById('title').textContent = top.label;
    document.getElementById('state').textContent = STATE_LABELS[top.status] || '';
    var dot = document.getElementById('dot');
    dot.className = 'dot accent-' + top.status;
    var action = document.getElementById('action');
    if (top.lastSummary) {
      action.textContent = top.lastSummary;
      action.className = 'action';
    } else {
      action.textContent = '正在观察界面…';
      action.className = 'action empty';
    }
  };
</script>
</body>
</html>`
