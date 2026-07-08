/**
 * TerminalService — session-scoped interactive PTY dock for the built-in terminal panel.
 *
 * 管理 node-pty 进程生命周期：
 *   - 创建 / 列出 / 输入 / resize / kill / 重命名 / 取历史 buffer
 *   - 每个 session 保留自己的 tabs；切会话不杀进程
 *   - 输出走 stream:terminal:event 主→渲染单向推送
 *   - App 退出 / session 删除 / workspace 删除时清掉对应 PTY
 *
 * 设计要点：
 *   - 单实例（singleton），整个 main 进程一份
 *   - PTY 只在主进程；renderer 不接触 Node API
 *   - 输出 ring buffer：每个 terminal 缓存最近 ~1MB，便于切 tab 时补屏
 *   - cwd 安全：必须等于或在 workspace.rootPath 子目录；no-project 用 app 管理目录或 home
 *   - shell 由 main 决定，renderer 不能传 shell path
 */
import { spawn } from 'node-pty'
import type { IPty } from 'node-pty'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import type {
  TerminalCreateRequest,
  TerminalCreateResponse,
  TerminalId,
  TerminalSessionActivity,
  TerminalSessionInfo,
  TerminalStreamEvent,
} from '@spark/protocol'
import { WorkspaceRepository } from '@spark/storage'
import { getDatabase } from '../db.js'
import { pushStreamEvent } from '../ipc/typed-ipc.js'

const log = createLogger('terminal:service')

/** ring buffer 上限（字节） */
const RING_BUFFER_MAX_BYTES = 1_048_576 // 1 MiB
/** 单次写 PTY 的最大字节数（防御性） */
const INPUT_MAX_BYTES = 1_048_576

/** 单条终端进程的运行时数据 */
interface TerminalRuntime {
  info: TerminalSessionInfo
  pty: IPty
  /** 累积输出缓存（字符串） */
  buffer: string
  /** 缓存字节数 */
  bufferBytes: number
}

class TerminalService {
  private readonly terminals = new Map<TerminalId, TerminalRuntime>()
  /** 已注册 disposal hooks（app quit / session 删除触发） */
  private disposed = false

  // ─── 公开 API ─────────────────────────────────────────────────────────────

  list(sessionId: string): TerminalSessionInfo[] {
    const out: TerminalSessionInfo[] = []
    for (const runtime of this.terminals.values()) {
      if (runtime.info.sessionId === sessionId) {
        out.push(runtime.info)
      }
    }
    return out
  }

  listActiveSessions(): TerminalSessionActivity[] {
    return buildTerminalSessionActivity(
      Array.from(this.terminals.values(), (runtime) => runtime.info),
    )
  }

  getBuffer(terminalId: string): string {
    const runtime = this.terminals.get(terminalId)
    return runtime?.buffer ?? ''
  }

  input(terminalId: string, data: string): boolean {
    const runtime = this.terminals.get(terminalId)
    if (runtime == null || runtime.info.status !== 'running') return false
    if (data.length > INPUT_MAX_BYTES) {
      // 超过单次上限：取最后一截（典型场景是粘贴大文件），避免把 PTY 撑爆
      data = data.slice(data.length - INPUT_MAX_BYTES)
    }
    try {
      runtime.pty.write(data)
      return true
    } catch (err) {
      log.warn(
        `terminal ${terminalId} write failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const runtime = this.terminals.get(terminalId)
    if (runtime == null || runtime.info.status !== 'running') return false
    const safeCols = Math.max(10, Math.min(500, Math.floor(cols)))
    const safeRows = Math.max(3, Math.min(200, Math.floor(rows)))
    try {
      runtime.pty.resize(safeCols, safeRows)
      runtime.info.cols = safeCols
      runtime.info.rows = safeRows
      runtime.info.updatedAt = new Date().toISOString()
      return true
    } catch (err) {
      log.warn(
        `terminal ${terminalId} resize failed: ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  kill(terminalId: string): boolean {
    const runtime = this.terminals.get(terminalId)
    if (runtime == null) return false
    try {
      runtime.pty.kill()
    } catch (err) {
      log.warn(
        `terminal ${terminalId} kill failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    this.disposeRuntime(terminalId, 'kill', { killPty: false })
    return true
  }

  rename(terminalId: string, title: string): TerminalSessionInfo | null {
    const runtime = this.terminals.get(terminalId)
    if (runtime == null) return null
    const trimmed = title.trim().slice(0, 80) || runtime.info.title
    runtime.info.title = trimmed
    runtime.info.updatedAt = new Date().toISOString()
    this.push({ type: 'updated', terminal: runtime.info })
    return runtime.info
  }

  /**
   * 创建 PTY。会做以下事：
   *   1. 解析 sessionId → workspaces，决定允许的 cwd 范围
   *   2. 校验 cwd 在范围内
   *   3. 选定 shell（不信任 renderer 传入）
   *   4. spawn node-pty，注册 onData / onExit
   *   5. 推送 'created' stream 事件
   */
  create(req: TerminalCreateRequest): TerminalCreateResponse {
    if (this.disposed) {
      throw new Error('TerminalService has been disposed')
    }
    const sessionId = req.sessionId
    const { cwd, rootPath } = this.resolveCwd(req)
    const shell = pickShell()
    const cols = clampInt(req.cols ?? 80, 10, 500)
    const rows = clampInt(req.rows ?? 24, 3, 200)
    const id = makeTerminalId()
    const now = new Date().toISOString()
    const title = (req.title?.trim() || deriveTitle(rootPath)).slice(0, 80)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
    }
    if (process.platform !== 'win32') {
      env.PWD = cwd
    }

    let ptyProc: IPty
    try {
      ptyProc = spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: env as Record<string, string>,
        // Node-pty 在 macOS / Linux 上 fork 出 shell process；Windows 上用 ConPTY。
        useConpty: process.platform === 'win32',
      })
    } catch (err) {
      log.error(`terminal spawn failed: ${err instanceof Error ? err.message : String(err)}`)
      this.push({
        type: 'error',
        sessionId,
        message: `无法启动 shell: ${err instanceof Error ? err.message : String(err)}`,
      })
      throw err
    }

    const info: TerminalSessionInfo = {
      id,
      sessionId,
      ...(req.workspaceId != null ? { workspaceId: req.workspaceId } : {}),
      title,
      cwd,
      shell,
      pid: ptyProc.pid,
      cols,
      rows,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }
    const runtime: TerminalRuntime = {
      info,
      pty: ptyProc,
      buffer: '',
      bufferBytes: 0,
    }
    this.terminals.set(id, runtime)

    ptyProc.onData((data) => {
      this.handleData(id, data)
    })
    ptyProc.onExit(({ exitCode, signal }) => {
      this.handleExit(id, exitCode, signal)
    })

    log.info(`terminal created: id=${id} cwd=${cwd} shell=${shell} pid=${ptyProc.pid ?? 'n/a'}`)
    this.push({ type: 'created', terminal: info })
    return { terminal: info }
  }

  /** 把 sessionId 下所有 PTY 杀掉。返回被销毁的数量 */
  disposeBySession(sessionId: string, opts: { defer?: boolean } = {}): number {
    const ids: string[] = []
    for (const [id, runtime] of this.terminals) {
      if (runtime.info.sessionId !== sessionId) continue
      ids.push(id)
    }
    this.disposeMany(ids, 'session-delete', opts)
    return ids.length
  }

  /** 把 workspaceId 下所有 PTY 杀掉（用于 workspace 删除 / 关闭） */
  disposeByWorkspaceId(workspaceId: string, opts: { defer?: boolean } = {}): number {
    const ids: string[] = []
    for (const [id, runtime] of this.terminals) {
      if (runtime.info.workspaceId !== workspaceId) continue
      ids.push(id)
    }
    this.disposeMany(ids, 'workspace-dispose', opts)
    return ids.length
  }

  /** 杀掉所有 PTY。app quit 触发 */
  disposeAll(): void {
    if (this.disposed) return
    this.disposed = true
    const ids = [...this.terminals.keys()]
    for (const id of ids) {
      this.disposeRuntime(id, 'app-quit')
    }
    log.info(`TerminalService disposed (${ids.length} terminals)`)
  }

  // ─── 内部 ─────────────────────────────────────────────────────────────────

  private handleData(id: string, data: string): void {
    const runtime = this.terminals.get(id)
    if (runtime == null) return
    runtime.info.updatedAt = new Date().toISOString()
    // 更新 ring buffer
    runtime.bufferBytes += Buffer.byteLength(data, 'utf8')
    runtime.buffer += data
    if (runtime.bufferBytes > RING_BUFFER_MAX_BYTES) {
      // 从头截断，保留末尾 ~1MiB
      const overflow = runtime.bufferBytes - RING_BUFFER_MAX_BYTES
      let cut = 0
      let bytes = 0
      while (cut < runtime.buffer.length && bytes < overflow) {
        bytes += Buffer.byteLength(runtime.buffer.charAt(cut), 'utf8')
        cut += 1
      }
      runtime.buffer = runtime.buffer.slice(cut)
      runtime.bufferBytes -= bytes
    }
    this.push({
      type: 'data',
      terminalId: id,
      sessionId: runtime.info.sessionId,
      data,
    })
  }

  private handleExit(id: string, exitCode: number, signal?: number): void {
    const runtime = this.terminals.get(id)
    if (runtime == null) return
    runtime.info.status = 'exited'
    runtime.info.exitCode = exitCode
    if (signal != null) runtime.info.signal = signal
    runtime.info.updatedAt = new Date().toISOString()
    log.info(`terminal exited: id=${id} code=${exitCode} signal=${signal ?? 0}`)
    this.push({
      type: 'exit',
      terminalId: id,
      sessionId: runtime.info.sessionId,
      exitCode,
      ...(signal != null ? { signal } : {}),
    })
  }

  private disposeMany(ids: string[], reason: string, opts: { defer?: boolean }): void {
    if (!opts.defer) {
      for (const id of ids) this.disposeRuntime(id, reason)
      return
    }
    for (const id of ids) {
      const runtime = this.terminals.get(id)
      if (runtime == null) continue
      const sessionId = runtime.info.sessionId
      this.terminals.delete(id)
      this.push({ type: 'removed', terminalId: id, sessionId })
      setTimeout(() => this.killRuntimePty(runtime, id, reason), 0)
    }
  }

  private disposeRuntime(id: string, _reason: string, opts: { killPty?: boolean } = {}): void {
    const runtime = this.terminals.get(id)
    if (runtime == null) return
    try {
      if (opts.killPty !== false && runtime.info.status === 'running') {
        runtime.pty.kill()
      }
    } catch {
      // ignore
    }
    const sessionId = runtime.info.sessionId
    this.terminals.delete(id)
    this.push({ type: 'removed', terminalId: id, sessionId })
  }

  private killRuntimePty(runtime: TerminalRuntime, id: string, reason: string): void {
    try {
      if (runtime.info.status === 'running') {
        runtime.pty.kill()
      }
    } catch (err) {
      log.warn(
        `terminal deferred kill failed: id=${id} reason=${reason} error=${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }

  private push(event: TerminalStreamEvent): void {
    try {
      pushStreamEvent('stream:terminal:event', event)
    } catch (err) {
      log.warn(`pushStreamEvent failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // ─── cwd / workspace 解析 ───────────────────────────────────────────────

  private resolveCwd(req: TerminalCreateRequest): { cwd: string; rootPath: string } {
    // 1. 取该 session 关联的 workspaces
    const repo = new WorkspaceRepository(getDatabase())
    const workspaces: { id: string; name: string; root_path: string }[] = []
    if (req.workspaceId != null) {
      const ws = repo.get(req.workspaceId)
      if (ws != null) workspaces.push(ws)
    }
    if (workspaces.length === 0) {
      // 没有 workspaceId 时回落到 no-project workspace
      const noProject = repo
        .listAll(100, 0, { includeArchived: true })
        .find((w) => w.name === NO_PROJECT_WORKSPACE_NAME)
      if (noProject != null) workspaces.push(noProject)
    }
    const primary = workspaces[0]
    const rootPath = primary != null ? path.resolve(primary.root_path) : homedir()
    const fallbackCwd = primary != null ? rootPath : homedir()

    // 2. 解析并校验 req.cwd
    const requested = req.cwd?.trim() || fallbackCwd
    let resolved: string
    try {
      resolved = realpathSync(requested)
    } catch {
      // 路径不存在时回落到 fallback
      resolved = path.resolve(requested)
    }

    // 3. 安全：必须等于 rootPath，或在其之下
    if (!isWithinOrEqual(resolved, rootPath)) {
      // no-project 兜底：允许 homedir 之下（app 管理的持久 no-project 目录本身就在 userData 下）
      if (workspaces.length === 0 && isWithinOrEqual(resolved, homedir())) {
        return { cwd: resolved, rootPath }
      }
      throw new Error(`终端工作目录不可用：${resolved} 不在 workspace 内`)
    }
    return { cwd: resolved, rootPath }
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function makeTerminalId(): string {
  return `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function pickShell(): string {
  if (process.platform === 'win32') {
    // 优先级：pwsh → powershell → cmd
    if (process.env['SHELL'] != null && existsSync(process.env['SHELL']))
      return process.env['SHELL']
    if (existsSync('C:/Program Files/PowerShell/7/pwsh.exe'))
      return 'C:/Program Files/PowerShell/7/pwsh.exe'
    if (existsSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'))
      return 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
    return 'cmd.exe'
  }
  const envShell = process.env['SHELL']
  if (envShell != null && envShell.length > 0 && existsSync(envShell)) return envShell
  if (existsSync('/bin/zsh')) return '/bin/zsh'
  if (existsSync('/bin/bash')) return '/bin/bash'
  return '/bin/sh'
}

function isWithinOrEqual(target: string, parent: string): boolean {
  if (target === parent) return true
  const rel = path.relative(parent, target)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function deriveTitle(rootPath: string): string {
  const base = path.basename(rootPath) || rootPath
  return base.replace(/[\r\n\t]/g, ' ').slice(0, 80) || 'Terminal'
}

const NO_PROJECT_WORKSPACE_NAME = '不使用项目'

// ─── 单例 ────────────────────────────────────────────────────────────────────

let _instance: TerminalService | null = null

/**
 * 取 TerminalService 单例。
 * 整个主进程一份；ipc 注册 / app quit hook 都引用同一个实例。
 */
export function getTerminalService(): TerminalService {
  if (_instance == null) _instance = new TerminalService()
  return _instance
}

/** 测试用：重置单例 */
export function _resetTerminalServiceForTests(): void {
  _instance?.disposeAll()
  _instance = null
}

export type { TerminalRuntime }

export function buildTerminalSessionActivity(
  terminals: Iterable<TerminalSessionInfo>,
): TerminalSessionActivity[] {
  const bySession = new Map<string, TerminalSessionActivity>()
  for (const info of terminals) {
    const current = bySession.get(info.sessionId) ?? {
      sessionId: info.sessionId,
      running: 0,
      total: 0,
    }
    current.total += 1
    if (info.status === 'running') current.running += 1
    bySession.set(info.sessionId, current)
  }
  return [...bySession.values()]
    .filter((item) => item.running > 0)
    .sort(
      (a, b) =>
        b.running - a.running || b.total - a.total || a.sessionId.localeCompare(b.sessionId),
    )
}
