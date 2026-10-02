import { BrowserWindow, nativeImage, screen } from 'electron'

import type { ComputerUseEvent } from '@spark/protocol'
import { createLogger } from '@spark/shared'

import { ComputerUsePipProjection } from './ComputerUsePipProjection.js'
import type { ComputerUseTimelineStore } from './ComputerUseTimelineStore.js'

const log = createLogger('computer-use-pip')

/** Commands the inline panel may send back through the spark-pip:// URL lane. */
export type ComputerUsePipCommandVerb = 'pause' | 'takeover' | 'stop' | 'approve' | 'deny'

export const COMPUTER_USE_PIP_COMMAND_VERBS: readonly ComputerUsePipCommandVerb[] = [
  'pause',
  'takeover',
  'stop',
  'approve',
  'deny',
]

/**
 * Parses a `spark-pip://control/<verb>?sid=<computerSessionId>` URL. Returns
 * null for anything else so the window-open handler can ignore junk targets.
 */
export function parseComputerUsePipCommandUrl(url: string): {
  verb: ComputerUsePipCommandVerb
  computerSessionId: string
} | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'spark-pip:' || parsed.hostname !== 'control') return null
  const verb = parsed.pathname.replace(/^\/+/, '') as ComputerUsePipCommandVerb
  if (!COMPUTER_USE_PIP_COMMAND_VERBS.includes(verb)) return null
  const computerSessionId = parsed.searchParams.get('sid') ?? ''
  if (computerSessionId.length < 1) return null
  return { verb, computerSessionId }
}

/**
 * Remote-hosted PIP-style live panel: a small always-on-top, non-focusable
 * window showing what the agent is doing on the desktop right now — live
 * preview frame, target app, latest action summary, a status accent, and
 * one-gesture controls (pause / takeover / stop, approve / deny while an
 * action awaits approval). Mirrors the reverse-engineered Codex
 * RemoteHostedPIP surface, hosted by the app (not the native service)
 * because all live state (timeline events, sessions) lives here. Every
 * window/OS interaction is best-effort: the PIP must never influence task
 * execution.
 *
 * Page→main communication rides window.open('spark-pip://control/<verb>')
 * captured by setWindowOpenHandler (denied + parsed) — no preload, no extra
 * IPC surface. Main→page stays executeJavaScript pushes.
 */
export class ComputerUsePipService {
  private readonly timeline: ComputerUseTimelineStore
  private readonly projection: ComputerUsePipProjection
  private readonly unsubscribeTimeline: () => void
  private readonly evidence:
    | { peekLatestImage(computerSessionId: string): { bytes: Buffer } | null }
    | undefined
  private readonly onCommand:
    | ((verb: ComputerUsePipCommandVerb, computerSessionId: string) => Promise<unknown>)
    | undefined
  private window: BrowserWindow | null = null
  private disposed = false
  /** Terminal sessions linger briefly so the user sees the final status. */
  private readonly retireTimers = new Set<NodeJS.Timeout>()
  /** Newest projection snapshot; also picks the session the preview follows. */
  private lastSnapshot: ComputerUsePipProjectionReturnType = []
  private frameTimer: NodeJS.Timeout | null = null
  private readonly frameIntervalMs: number
  private readonly previewWidth: number

  constructor(options: {
    timeline: ComputerUseTimelineStore
    projection: ComputerUsePipProjection
    /** Frame source for the live preview; omitted disables the preview area. */
    evidence?: {
      peekLatestImage(computerSessionId: string): { bytes: Buffer } | null
    }
    /** Handles pause/takeover/stop/approve/deny issued from the panel. */
    onCommand?: (verb: ComputerUsePipCommandVerb, computerSessionId: string) => Promise<unknown>
    /** How long a terminal status stays on screen before the panel closes. */
    terminalLingerMs?: number
    /** Preview push cadence (default 1000ms). */
    frameIntervalMs?: number
    /** Preview thumbnail long edge (default 320px). */
    previewWidth?: number
  }) {
    this.timeline = options.timeline
    this.projection = options.projection
    this.evidence = options.evidence
    this.onCommand = options.onCommand
    this.terminalLingerMs = options.terminalLingerMs ?? 2_500
    this.frameIntervalMs = options.frameIntervalMs ?? 1_000
    this.previewWidth = options.previewWidth ?? 320
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
    this.stopFrameTicker()
    this.window?.destroy()
    this.window = null
  }

  private render(state: ComputerUsePipProjectionReturnType): void {
    if (this.disposed) return
    this.lastSnapshot = state
    if (state.length === 0) {
      this.closeWindow()
      return
    }
    const win = this.ensureWindow()
    if (win.isDestroyed()) return
    this.startFrameTicker()
    const payload = JSON.stringify(state).replace(/</g, '\\u003c')
    void win.webContents
      .executeJavaScript(`window.__sparkPipUpdate && window.__sparkPipUpdate(${payload}); true`)
      .catch(() => undefined)
  }

  private ensureWindow(): BrowserWindow {
    if (this.window != null && !this.window.isDestroyed()) return this.window
    const workArea = screen.getPrimaryDisplay().workArea
    const width = 316
    const height = 208
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
    // The inline page has no preload: panel commands ride denied window.open
    // navigations on a private scheme, parsed and dispatched here.
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const command = parseComputerUsePipCommandUrl(url)
        if (command != null) void this.dispatchCommand(command)
      } catch (error) {
        log.warn('PIP command dispatch failed', { error: stringify(error) })
      }
      return { action: 'deny' }
    })
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

  private dispatchCommand(command: {
    verb: ComputerUsePipCommandVerb
    computerSessionId: string
  }): void {
    const known = this.lastSnapshot.some(
      (session) => session.computerSessionId === command.computerSessionId,
    )
    if (!known) {
      log.warn('PIP command ignored for unknown session', {
        verb: command.verb,
        computerSessionId: command.computerSessionId,
      })
      return
    }
    const handler = this.onCommand
    if (handler == null) return
    void handler(command.verb, command.computerSessionId).catch((error: unknown) => {
      log.warn('PIP command failed', { verb: command.verb, error: stringify(error) })
      this.notifyPageError(command.verb)
    })
  }

  private notifyPageError(verb: ComputerUsePipCommandVerb): void {
    const win = this.window
    if (win == null || win.isDestroyed()) return
    const label =
      verb === 'pause'
        ? '暂停失败'
        : verb === 'takeover'
          ? '接管失败'
          : verb === 'stop'
            ? '停止失败'
            : verb === 'approve'
              ? '批准失败'
              : '拒绝失败'
    void win.webContents
      .executeJavaScript(
        `window.__sparkPipError && window.__sparkPipError(${JSON.stringify(label)}); true`,
      )
      .catch(() => undefined)
  }

  private startFrameTicker(): void {
    if (this.frameTimer != null || this.evidence == null) return
    this.frameTimer = setInterval(() => {
      try {
        this.pushPreviewFrame()
      } catch {
        // Best-effort preview: any failure just skips this tick.
      }
    }, this.frameIntervalMs)
    void this.pushPreviewFrame()
  }

  private stopFrameTicker(): void {
    if (this.frameTimer == null) return
    clearInterval(this.frameTimer)
    this.frameTimer = null
  }

  private pushPreviewFrame(): void {
    const win = this.window
    const evidence = this.evidence
    if (win == null || win.isDestroyed() || evidence == null) return
    const top = this.lastSnapshot[this.lastSnapshot.length - 1]
    if (top == null) return
    const frame = evidence.peekLatestImage(top.computerSessionId)
    if (frame == null || frame.bytes.length < 1) return
    const image = nativeImage.createFromBuffer(frame.bytes)
    if (image.isEmpty()) return
    const size = image.getSize()
    const scale =
      size.width > size.height
        ? this.previewWidth / Math.max(1, size.width)
        : this.previewWidth / Math.max(1, size.height)
    const resized =
      scale < 1
        ? image.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
          })
        : image
    const dataUrl = `data:image/jpeg;base64,${resized.toJPEG(70).toString('base64')}`
    void win.webContents
      .executeJavaScript(
        `window.__sparkPipFrame && window.__sparkPipFrame(${JSON.stringify(dataUrl)}); true`,
      )
      .catch(() => undefined)
  }

  private closeWindow(): void {
    this.stopFrameTicker()
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
 * any desktop; updates arrive via `__sparkPipUpdate(stateArray)` (status) and
 * `__sparkPipFrame(dataUrl)` (preview). Commands leave the page through
 * denied window.open navigations on the spark-pip:// scheme.
 */
const PIP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; font-family: -apple-system, "PingFang SC", sans-serif; }
  body { display: flex; align-items: stretch; justify-content: flex-end; }
  #card {
    width: 300px; box-sizing: border-box; padding: 10px 12px;
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
  .preview {
    margin-top: 7px; height: 96px; border-radius: 8px; overflow: hidden;
    background:
      repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, rgba(255,255,255,0.02) 0% 50%) 0 0 / 16px 16px,
      rgba(255,255,255,0.04);
    display: flex; align-items: center; justify-content: center; position: relative;
  }
  .preview img { width: 100%; height: 100%; object-fit: cover; display: none; opacity: 0; transition: opacity 0.25s; }
  .preview img.on { display: block; opacity: 1; }
  .preview .placeholder { font-size: 10px; color: rgba(255,255,255,0.35); }
  .action { margin-top: 6px; font-size: 11px; line-height: 1.45; color: rgba(255,255,255,0.82);
    min-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .action.empty { color: rgba(255,255,255,0.4); }
  .error { margin-top: 4px; font-size: 10px; color: #ff8a8a; display: none; }
  .controls { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
  .btn {
    appearance: none; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.85); border-radius: 7px; padding: 4px 9px; font-size: 11px; line-height: 1;
    cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
  }
  .btn:hover { background: rgba(255,255,255,0.15); }
  .btn:active { background: rgba(255,255,255,0.22); }
  .btn[disabled] { opacity: 0.35; cursor: default; }
  .btn.approve { border-color: rgba(56,201,121,0.5); background: rgba(56,201,121,0.16); color: #7ce6a8; }
  .btn.approve:hover { background: rgba(56,201,121,0.3); }
  .btn.deny { border-color: rgba(255,107,107,0.5); background: rgba(255,107,107,0.14); color: #ff9d9d; }
  .btn.deny:hover { background: rgba(255,107,107,0.28); }
  .approval-hint { font-size: 10px; color: #ffb1b1; margin-left: auto; }
  .spark { font-size: 9px; letter-spacing: 0.4px; color: rgba(255,255,255,0.35); margin-left: auto; }
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
  <div class="preview" id="preview">
    <img id="frame" alt="">
    <span class="placeholder" id="placeholder">等待画面…</span>
  </div>
  <div class="action empty" id="action">准备中…</div>
  <div class="error" id="error"></div>
  <div class="controls" id="controls">
    <button class="btn" id="btn-pause" title="暂停会话">⏸ 暂停</button>
    <button class="btn" id="btn-takeover" title="接管会话">✋ 接管</button>
    <button class="btn" id="btn-stop" title="停止会话">⏹ 停止</button>
    <span class="spark">SPARKWORK</span>
  </div>
  <div class="controls" id="approval" style="display:none">
    <button class="btn deny" id="btn-deny">✕ 拒绝</button>
    <button class="btn approve" id="btn-approve">✓ 批准</button>
    <span class="approval-hint">等待你的确认</span>
  </div>
</div>
<script>
  var STATE_LABELS = {
    running: '观察中', acting: '执行中', failed: '失败',
    awaiting_approval: '等待确认', completed: '已完成', stopped: '已停止'
  };
  var TERMINAL = { failed: 1, completed: 1, stopped: 1 };
  var top = null;
  function send(verb) {
    if (!top) return;
    window.open('spark-pip://control/' + verb + '?sid=' + encodeURIComponent(top.computerSessionId));
  }
  window.__sparkPipUpdate = function (sessions) {
    top = sessions[sessions.length - 1];
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
    var terminal = !!TERMINAL[top.status];
    var awaiting = top.status === 'awaiting_approval';
    var controls = document.getElementById('controls');
    var approval = document.getElementById('approval');
    controls.style.display = awaiting ? 'none' : 'flex';
    approval.style.display = awaiting ? 'flex' : 'none';
    document.getElementById('btn-pause').disabled = terminal;
    document.getElementById('btn-takeover').disabled = terminal;
    document.getElementById('btn-stop').disabled = terminal;
  };
  window.__sparkPipFrame = function (dataUrl) {
    var img = document.getElementById('frame');
    img.src = dataUrl;
    img.className = 'on';
    document.getElementById('placeholder').style.display = 'none';
  };
  window.__sparkPipError = function (label) {
    var el = document.getElementById('error');
    el.textContent = label;
    el.style.display = 'block';
    setTimeout(function () { el.style.display = 'none'; }, 2000);
  };
  document.getElementById('btn-pause').onclick = function () { send('pause'); };
  document.getElementById('btn-takeover').onclick = function () { send('takeover'); };
  document.getElementById('btn-stop').onclick = function () { send('stop'); };
  document.getElementById('btn-approve').onclick = function () { send('approve'); };
  document.getElementById('btn-deny').onclick = function () { send('deny'); };
</script>
</body>
</html>`
