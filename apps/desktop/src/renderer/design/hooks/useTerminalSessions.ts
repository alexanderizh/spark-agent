/**
 * useTerminalSessions — 内置终端 panel 的 tab 状态管理。
 *
 * 职责：
 *   - 维护 session 下的 terminal tabs 状态（list / active / unread）
 *   - 订阅 stream:terminal:event，把后端推送的数据/退出/创建事件合到本地 state
 *   - 提供 create / kill / rename / setActive 操作
 *   - 记住 panel 高度与 active terminal（localStorage）
 *
 * 与 PTY 生命周期的关系：
 *   - 后端 PTY 在 main 进程长期运行；切 tab 只是切换显示的 xterm 实例，不杀 PTY。
 *   - 关闭 tab → 调 terminal:kill 杀掉对应 PTY。
 *   - 关闭最后一个 tab → onLastTabClosed 通知 ChatView 关闭整个面板。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIpcInvoke, useIpcStream } from './useIpc'
import type {
  SessionId,
  TerminalId,
  TerminalSessionInfo,
  TerminalStreamEvent,
  WorkspaceInfo,
} from '@spark/protocol'

const DRAWER_WIDTH_KEY = 'spark.terminal.drawerWidth'
const ACTIVE_TERMINAL_PREFIX = 'spark.terminal.activeTerminalBySession.'
const DEFAULT_DRAWER_WIDTH = 480
const MIN_DRAWER_WIDTH = 320
const MAX_DRAWER_WIDTH = 900

export interface TerminalTabViewState {
  id: TerminalId
  title: string
  status: TerminalSessionInfo['status']
  cwd: string
  hasUnreadOutput: boolean
}

export interface UseTerminalSessionsResult {
  tabs: TerminalTabViewState[]
  activeTabId: TerminalId | null
  setActiveTabId: (id: TerminalId) => void
  createTab: (opts?: { title?: string; cwd?: string; cols?: number; rows?: number }) => Promise<void>
  killTab: (id: TerminalId) => Promise<void>
  renameTab: (id: TerminalId, title: string) => Promise<void>
  /** 标记该 tab 已被阅读（清除 unread 标记） */
  markRead: (id: TerminalId) => void
  /** 重新拉取后端列表（一般 mount 时用一次） */
  refresh: () => Promise<void>
  /** 后端是否已初始化完毕（第一次 list 返回） */
  ready: boolean
}

interface UseTerminalSessionsOptions {
  sessionId: string
  /** 当前会话绑定的 workspace；用它作为新建 terminal 的 cwd / workspaceId。
   *  若为空则后端会用 no-project workspace 或 home。 */
  workspace?: WorkspaceInfo | null
  /** 第一个 tab 自动创建（仅在 ready=true 且后端无 terminal 时） */
  autoCreateFirst: boolean
  /** 最后 tab 关闭时触发（用于关闭整个面板） */
  onLastTabClosed: () => void
}

export function useTerminalSessions(
  opts: UseTerminalSessionsOptions,
): UseTerminalSessionsResult {
  const { sessionId, workspace, autoCreateFirst, onLastTabClosed } = opts
  const { invoke: listTerminals } = useIpcInvoke('terminal:list')
  const { invoke: createTerminal } = useIpcInvoke('terminal:create')
  const { invoke: killTerminal } = useIpcInvoke('terminal:kill')
  const { invoke: renameTerminal } = useIpcInvoke('terminal:rename')

  const [tabs, setTabs] = useState<TerminalTabViewState[]>([])
  const [activeTabId, setActiveTabIdState] = useState<TerminalId | null>(null)
  const [ready, setReady] = useState(false)
  const didAutoCreateRef = useRef(false)

  // ─── 拉取后端列表 ────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const res = await listTerminals({ sessionId: sessionId as SessionId })
      const list: TerminalTabViewState[] = res.terminals.map((info: TerminalSessionInfo) => ({
        id: info.id,
        title: info.title,
        status: info.status,
        cwd: info.cwd,
        hasUnreadOutput: false,
      }))
      setTabs(list)
      setReady(true)
      // 自动设置 active（首次）
      if (activeTabIdRef.current == null && list.length > 0) {
        const remembered = readRememberedActive(sessionId)
        const candidate = list.find((t) => t.id === remembered) ?? list[0]
        if (candidate != null) {
          setActiveTabIdState(candidate.id)
        }
      }
    } catch (err) {
      // 拉取失败保留旧 tabs；后端下次 stream 推送时会更新
      console.warn('[useTerminalSessions] list failed:', err)
      setReady(true)
    }
  }, [listTerminals, sessionId])

  // 暴露 active id ref（供 refresh 内部读取最新值）
  const activeTabIdRef = useRef<string | null>(activeTabId)
  activeTabIdRef.current = activeTabId

  useEffect(() => {
    void refresh()
  }, [refresh])

  // ─── stream 订阅 ────────────────────────────────────────────────────────
  useIpcStream('stream:terminal:event', (event: TerminalStreamEvent) => {
    // 只关心本 session
    if ('sessionId' in event && event.sessionId != null && event.sessionId !== sessionId) {
      return
    }
    switch (event.type) {
      case 'created':
        setTabs((prev) => {
          if (prev.some((t) => t.id === event.terminal.id)) return prev
          const next = [
            ...prev,
            {
              id: event.terminal.id,
              title: event.terminal.title,
              status: event.terminal.status,
              cwd: event.terminal.cwd,
              hasUnreadOutput: false,
            },
          ]
          // 自动激活：首个 tab 或者还没 active 时
          if (activeTabIdRef.current == null) {
            setActiveTabIdState(event.terminal.id)
          }
          return next
        })
        break
      case 'data':
        // 不直接更新 state（data 由 xterm 处理）
        // 只在非 active tab 上累计 unread
        setTabs((prev) =>
          prev.map((t) =>
            t.id === event.terminalId && t.id !== activeTabIdRef.current
              ? { ...t, hasUnreadOutput: true }
              : t,
          ),
        )
        break
      case 'exit':
        setTabs((prev) =>
          prev.map((t) =>
            t.id === event.terminalId
              ? {
                  ...t,
                  status: 'exited',
                  hasUnreadOutput: false,
                }
              : t,
          ),
        )
        break
      case 'updated':
        setTabs((prev) =>
          prev.map((t) =>
            t.id === event.terminal.id
              ? {
                  ...t,
                  title: event.terminal.title,
                  cwd: event.terminal.cwd,
                  status: event.terminal.status,
                }
              : t,
          ),
        )
        break
      case 'removed':
        setTabs((prev) => {
          const next = prev.filter((t) => t.id !== event.terminalId)
          // 如果删的是 active，切到第一个剩余；没有则清空
          if (activeTabIdRef.current === event.terminalId) {
            setActiveTabIdState(next[0]?.id ?? null)
          }
          if (next.length === 0) {
            // 推迟到下一个 tick：避免在 setState 内调外部回调
            queueMicrotask(() => onLastTabClosed())
          }
          return next
        })
        break
      case 'error':
        // 仅记录；不更新 tab
        console.warn('[terminal] stream error:', event.message)
        break
    }
  })

  // ─── 自动创建第一个 tab ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !autoCreateFirst || didAutoCreateRef.current) return
    if (tabs.length > 0) {
      didAutoCreateRef.current = true
      return
    }
    didAutoCreateRef.current = true
    void createTerminal({
      sessionId: sessionId as SessionId,
      // 把会话 workspace 透传给后端，让 PTY 在会话项目目录打开
      ...(workspace?.id != null ? { workspaceId: workspace.id } : {}),
      ...(workspace?.rootPath != null ? { cwd: workspace.rootPath } : {}),
      cols: 80,
      rows: 24,
    }).catch((err) => {
      console.warn('[useTerminalSessions] auto create failed:', err)
    })
  }, [ready, autoCreateFirst, tabs.length, createTerminal, sessionId, workspace])

  // ─── 切 session 时重置 didAutoCreate ───────────────────────────────────
  useEffect(() => {
    didAutoCreateRef.current = false
  }, [sessionId])

  // ─── 操作 API ──────────────────────────────────────────────────────────
  const setActiveTabId = useCallback(
    (id: TerminalId) => {
      setActiveTabIdState(id)
      writeRememberedActive(sessionId, id)
      // 清 unread
      setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, hasUnreadOutput: false } : t)))
    },
    [sessionId],
  )

  const createTab = useCallback(
    async (extra?: { title?: string; cwd?: string; cols?: number; rows?: number }) => {
      // 用户手动新建 tab：默认在会话项目目录下打开；调用方可显式覆盖 cwd
      const fallbackCwd = extra?.cwd ?? workspace?.rootPath
      const res = await createTerminal({
        sessionId: sessionId as SessionId,
        ...(workspace?.id != null ? { workspaceId: workspace.id } : {}),
        ...(extra?.title != null ? { title: extra.title } : {}),
        ...(fallbackCwd != null ? { cwd: fallbackCwd } : {}),
        cols: extra?.cols ?? 80,
        rows: extra?.rows ?? 24,
      })
      setActiveTabId(res.terminal.id)
    },
    [createTerminal, sessionId, workspace],
  )

  const killTab = useCallback(
    async (id: TerminalId) => {
      await killTerminal({ terminalId: id })
    },
    [killTerminal],
  )

  const renameTab = useCallback(
    async (id: TerminalId, title: string) => {
      await renameTerminal({ terminalId: id, title })
    },
    [renameTerminal],
  )

  const markRead = useCallback((id: TerminalId) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, hasUnreadOutput: false } : t)))
  }, [])

  return useMemo(
    () => ({
      tabs,
      activeTabId,
      setActiveTabId,
      createTab,
      killTab,
      renameTab,
      markRead,
      refresh,
      ready,
    }),
    [tabs, activeTabId, setActiveTabId, createTab, killTab, renameTab, markRead, refresh, ready],
  )
}

// ─── 宽度 / active 持久化 ──────────────────────────────────────────────────

export const TERMINAL_PANEL_STORAGE_KEYS = {
  width: DRAWER_WIDTH_KEY,
  activePrefix: ACTIVE_TERMINAL_PREFIX,
} as const

export function readStoredDrawerWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_DRAWER_WIDTH
  try {
    const raw = window.localStorage.getItem(DRAWER_WIDTH_KEY)
    if (raw == null) return DEFAULT_DRAWER_WIDTH
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return DEFAULT_DRAWER_WIDTH
    return Math.max(MIN_DRAWER_WIDTH, Math.min(MAX_DRAWER_WIDTH, parsed))
  } catch {
    return DEFAULT_DRAWER_WIDTH
  }
}

export function writeStoredDrawerWidth(width: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DRAWER_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // ignore
  }
}

function readRememberedActive(sessionId: string): TerminalId | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(ACTIVE_TERMINAL_PREFIX + sessionId)
  } catch {
    return null
  }
}

function writeRememberedActive(sessionId: string, id: TerminalId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_TERMINAL_PREFIX + sessionId, id)
  } catch {
    // ignore
  }
}

export const TERMINAL_PANEL_LIMITS = {
  min: MIN_DRAWER_WIDTH,
  default: DEFAULT_DRAWER_WIDTH,
  max: MAX_DRAWER_WIDTH,
} as const
