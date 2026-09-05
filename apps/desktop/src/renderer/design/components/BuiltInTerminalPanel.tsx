/**
 * BuiltInTerminalPanel — 会话内交互式 PTY 终端面板（右侧可伸缩 drawer）。
 *
 * 位置：chat-layout 内、ChatInspector 之前/之后的右侧侧拉框（flex column）。
 *       不进入 chat-main —— 跟 ChatInspector 同层级。
 * 功能：
 *   - 多 tab：每个 tab 对应主进程一个 node-pty 进程
 *   - 切 tab 不杀 PTY：xterm 切到目标 tab 时拉取 ring buffer 补屏
 *   - 左侧 4px resize 竖条（参考 ChatInspector）
 *   - 关最后一个 tab → 整个面板关闭 + 后端 PTY kill
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Icons } from '../Icons'
import { useToast } from './Toast'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import {
  TERMINAL_PANEL_LIMITS,
  readStoredDrawerWidth,
  writeStoredDrawerWidth,
} from '../hooks/useTerminalSessions'
import {
  useTerminalSessions,
  type TerminalTabViewState,
} from '../hooks/useTerminalSessions'
import {
  BuiltInTerminalContextMenu,
  type TerminalContextMenuActions,
  type TerminalContextMenuState,
} from './terminal/BuiltInTerminalContextMenu'
import { findLinkAtCell, pickTerminalCell } from './terminal/terminalLinkProbe'
import type {
  TerminalId,
  TerminalStreamEvent,
  WorkspaceInfo,
} from '@spark/protocol'
import './BuiltInTerminalPanel.less'

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

interface BuiltInTerminalPanelProps {
  sessionId: string
  workspace: WorkspaceInfo | null
  /** 面板关闭（X 按钮 / 最后一个 tab 关闭 / 外部命令） */
  onClose: () => void
}

export function BuiltInTerminalPanel({
  sessionId,
  workspace,
  onClose,
}: BuiltInTerminalPanelProps) {
  const { tabs, activeTabId, setActiveTabId, createTab, killTab, renameTab, ready } =
    useTerminalSessions({
      sessionId,
      workspace,
      autoCreateFirst: true,
      onLastTabClosed: () => onClose(),
    })

  const [width, setWidth] = useState<number>(() => readStoredDrawerWidth())
  const [renameTarget, setRenameTarget] = useState<TerminalId | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const widthRef = useRef(width)

  // ─── xterm 实例注册表 + 应用菜单编辑命令联动 ────────────────────────────────
  // macOS ⌘C/⌘A 走应用菜单 accelerator（主进程 dispatchEditAction），先执行原生
  // 复制/全选，再推送 stream:app-menu:action；若焦点在终端内，这里用 xterm 选区接管。
  const terminalsRef = useRef<Map<TerminalId, Terminal>>(new Map())
  const registerTerm = useCallback(
    (id: TerminalId, term: Terminal | null) => {
      if (term == null) terminalsRef.current.delete(id)
      else terminalsRef.current.set(id, term)
    },
    [],
  )

  const { invoke: openExternal } = useIpcInvoke('browser:open-external')
  const { invoke: clearTerminalBuffer } = useIpcInvoke('terminal:clear')

  useIpcStream('stream:app-menu:action', (event) => {
    const active = document.activeElement
    const host =
      active instanceof Element
        ? active.closest<HTMLElement>('.terminal-xterm[data-terminal-id]')
        : null
    if (host == null) return
    const id = host.dataset.terminalId
    if (id == null) return
    const term = terminalsRef.current.get(id)
    if (term == null) return
    // 终端接管前先清掉主进程 copy/selectAll 留下的原生页面选区（xterm 选区不是
    // 原生选区，不清会把侧栏/消息等 DOM 文本残留成蓝色 ::selection 高亮）
    window.getSelection()?.removeAllRanges()
    if (event.action === 'app-copy') {
      if (term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
      }
      return
    }
    term.selectAll()
  })

  // ─── 右键菜单 ───────────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null)
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const contextActions = useMemo<TerminalContextMenuActions>(() => {
    const getTerm = (): Terminal | null => {
      if (contextMenu == null) return null
      return terminalsRef.current.get(contextMenu.terminalId) ?? null
    }
    const focusBack = (term: Terminal | null) => term?.focus()
    return {
      onCopy: () => {
        const term = getTerm()
        const text = term?.getSelection() ?? ''
        if (term != null && text.length > 0) {
          void navigator.clipboard.writeText(text).catch(() => {})
        }
        focusBack(term)
      },
      onPaste: () => {
        const term = getTerm()
        if (term == null) return
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text.length > 0) term.paste(text)
          })
          .catch(() => {})
          .finally(() => focusBack(term))
      },
      onSelectAll: () => {
        const term = getTerm()
        term?.selectAll()
        focusBack(term)
      },
      onClear: () => {
        const term = getTerm()
        // 视图清屏 + 清主进程 ring buffer，避免切 tab 补屏时旧内容复活
        term?.clear()
        if (contextMenu != null) {
          void clearTerminalBuffer({ terminalId: contextMenu.terminalId }).catch(() => {})
        }
        focusBack(term)
      },
      onOpenLink: (url) => {
        void openExternal({ url }).catch((err: unknown) => {
          console.warn('[terminal] open link failed:', err)
        })
      },
      onCopyLink: (url) => {
        void navigator.clipboard.writeText(url).catch(() => {})
      },
    }
  }, [contextMenu, clearTerminalBuffer, openExternal])

  // ─── resize handle (左侧竖条，水平拖动改宽度) ─────────────────────────────
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const onResizeHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startWidth: width }
    document.body.classList.add('terminal-resizing')
  }
  const onResizeHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (drag == null) return
    // 向左拖 = 加宽
    const delta = drag.startX - e.clientX
    const minW = TERMINAL_PANEL_LIMITS.min
    const maxW = TERMINAL_PANEL_LIMITS.max
    const next = Math.max(minW, Math.min(maxW, drag.startWidth + delta))
    widthRef.current = next
    setWidth(next)
  }
  const onResizeHandlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
    document.body.classList.remove('terminal-resizing')
    writeStoredDrawerWidth(widthRef.current)
  }

  const style = useMemo<CSSProperties>(
    () => ({ '--terminal-drawer-width': `${width}px` } as CSSProperties),
    [width],
  )

  return (
    <div className="builtin-terminal-panel" style={style}>
      <div
        className="terminal-resize-handle"
        onPointerDown={onResizeHandlePointerDown}
        onPointerMove={onResizeHandlePointerMove}
        onPointerUp={onResizeHandlePointerUp}
        onPointerCancel={onResizeHandlePointerUp}
        role="separator"
        aria-orientation="vertical"
        title="拖动调整宽度"
      />
      <div className="terminal-drawer">
      <div className="terminal-tabbar">
        <div className="terminal-tabbar-tabs">
          {tabs.map((tab) => (
            <TerminalTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              onSelect={() => setActiveTabId(tab.id)}
              onClose={() => {
                if (tabs.length === 1) {
                  // 最后一个 tab：关闭会触发 onLastTabClosed，由 ChatView 收口
                }
                void killTab(tab.id)
              }}
              onStartRename={() => {
                setRenameTarget(tab.id)
                setRenameValue(tab.title)
              }}
            />
          ))}
          <button
            type="button"
            className="terminal-tabbar-btn"
            title="新建终端"
            onClick={() => {
              void createTab({ cols: 80, rows: 24 })
            }}
          >
            <Icons.Plus size={12} />
          </button>
        </div>
        <div className="terminal-tabbar-actions">
          <button
            type="button"
            className="terminal-tabbar-btn"
            title="关闭终端面板"
            onClick={onClose}
          >
            <Icons.X size={12} />
          </button>
        </div>
      </div>

      {/* rename 输入条 */}
      {renameTarget != null && (
        <div className="terminal-rename-bar">
          <input
            autoFocus
            value={renameValue}
            maxLength={80}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = renameValue.trim()
                if (trimmed.length > 0 && renameTarget != null) {
                  void renameTab(renameTarget, trimmed)
                }
                setRenameTarget(null)
              } else if (e.key === 'Escape') {
                setRenameTarget(null)
              }
            }}
            onBlur={() => {
              const trimmed = renameValue.trim()
              if (trimmed.length > 0 && renameTarget != null) {
                void renameTab(renameTarget, trimmed)
              }
              setRenameTarget(null)
            }}
            placeholder="终端标签名称"
          />
        </div>
      )}

      <div className="terminal-body">
        {ready && tabs.length === 0 && (
          <div className="terminal-empty">
            <Icons.Terminal size={20} />
            <span>没有终端</span>
            <button
              type="button"
              className="terminal-empty-btn"
              onClick={() => {
                void createTab({ cols: 80, rows: 24 })
              }}
            >
              <Icons.Plus size={12} />
              新建终端
            </button>
          </div>
        )}
        {tabs.map((tab) => (
          <TerminalBody
            key={tab.id}
            tab={tab}
            sessionId={sessionId}
            isActive={tab.id === activeTabId}
            workspace={workspace}
            registerTerm={registerTerm}
            onContextMenuRequest={setContextMenu}
          />
        ))}
      </div>
      {contextMenu != null && (
        <BuiltInTerminalContextMenu
          state={contextMenu}
          actions={contextActions}
          onClose={closeContextMenu}
        />
      )}
      </div>
    </div>
  )
}

function TerminalTab({
  tab,
  isActive,
  onSelect,
  onClose,
  onStartRename,
}: {
  tab: TerminalTabViewState
  isActive: boolean
  onSelect: () => void
  onClose: () => void
  onStartRename: () => void
}) {
  return (
    <div
      className={`terminal-tab ${isActive ? 'active' : ''} ${tab.status === 'exited' ? 'exited' : ''}`}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      title={`${tab.title} · ${tab.cwd}`}
    >
      {tab.hasUnreadOutput && <span className="terminal-tab-dot" aria-label="有新输出" />}
      <span className="terminal-tab-title">{tab.title}</span>
      {tab.status === 'exited' && <span className="terminal-tab-exited">·exited</span>}
      <button
        type="button"
        className="terminal-tab-close"
        title="关闭终端"
        aria-label="关闭终端"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        <Icons.X style={{transform: 'scale(2.4)'}} />
      </button>
    </div>
  )
}

// ─── 单个 xterm 实例 ─────────────────────────────────────────────────────────

interface TerminalBodyProps {
  tab: TerminalTabViewState
  sessionId: string
  isActive: boolean
  workspace: WorkspaceInfo | null
  /** 把 xterm 实例注册到面板级 registry（⌘C/⌘A 菜单联动、右键菜单用） */
  registerTerm: (id: TerminalId, term: Terminal | null) => void
  /** 右键菜单请求（坐标、选区、链接上下文），由面板统一渲染 */
  onContextMenuRequest: (state: TerminalContextMenuState) => void
}

const TERMINAL_THEME_DARK = {
  background: '#08080a',
  foreground: '#e5e7eb',
  cursor: '#60a5fa',
  cursorAccent: '#08080a',
  selectionBackground: '#1e40af',
  black: '#08080a',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e5e7eb',
  brightBlack: '#475569',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#f8fafc',
}

const TERMINAL_THEME_LIGHT = {
  background: '#ebe9e3',
  foreground: '#24211d',
  cursor: '#6366f1',
  cursorAccent: '#ebe9e3',
  selectionBackground: '#c7d2fe',
  black: '#24211d',
  red: '#dc2626',
  green: '#16a34a',
  yellow: '#ca8a04',
  blue: '#2563eb',
  magenta: '#9333ea',
  cyan: '#0891b2',
  white: '#fafafa',
  brightBlack: '#71717a',
  brightRed: '#ef4444',
  brightGreen: '#22c55e',
  brightYellow: '#eab308',
  brightBlue: '#3b82f6',
  brightMagenta: '#a855f7',
  brightCyan: '#06b6d4',
  brightWhite: '#ffffff',
}

/**
 * 监听 <html data-theme="light|dark"> 切换，返回当前实际主题。
 * 当 AppProvider 写入 dataset.theme 时同步刷新，便于 xterm theme 跟随主题切换。
 */
function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light'
    const current = document.documentElement.dataset.theme
    return current === 'dark' ? 'dark' : 'light'
  })
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sync = () => {
      const next = root.dataset.theme === 'dark' ? 'dark' : 'light'
      setTheme((prev) => (prev === next ? prev : next))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

const RESIZE_DEBOUNCE_MS = 80
const TERMINAL_FONT_SIZE = 14
// xterm rounds this value when calculating the cell width. Sub-pixel positive
// values such as 0.1 therefore render almost the same as the default 0.
const TERMINAL_LETTER_SPACING = -1
const TERMINAL_LINE_HEIGHT = 1.2

function TerminalBody({
  tab,
  sessionId,
  isActive,
  workspace: _workspace,
  registerTerm,
  onContextMenuRequest,
}: TerminalBodyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webLinksRef = useRef<WebLinksAddon | null>(null)
  const [mounted, setMounted] = useState(false)
  const { invoke: getBuffer } = useIpcInvoke('terminal:get-buffer')
  const { invoke: resizeIpc } = useIpcInvoke('terminal:resize')
  const { invoke: inputIpc } = useIpcInvoke('terminal:input')
  const { toast } = useToast()
  const lastColsRowsRef = useRef<{ cols: number; rows: number } | null>(null)
  const resolvedTheme = useResolvedTheme()

  // 一次性创建 xterm 实例（每个 tab 一次）
  useEffect(() => {
    const container = containerRef.current
    if (container == null) return
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      convertEol: true,
      fontFamily: 'var(--font-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: TERMINAL_FONT_SIZE,
      letterSpacing: TERMINAL_LETTER_SPACING,
      lineHeight: TERMINAL_LINE_HEIGHT,
      scrollback: 5_000,
      theme: resolvedTheme === 'dark' ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // 链接点击：默认 handler 用无参 window.open() 造 about:blank 再跳转，会被主进程
    // ExternalUrlPolicy 拦掉（表现为点了没反应）。改成直接带 URL 打开，由
    // setWindowOpenHandler → browser:open-external 同款安全策略在系统浏览器打开。
    const webLinks = new WebLinksAddon((_event, url) => {
      window.open(url, '_blank')
    })
    term.loadAddon(webLinks)
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    webLinksRef.current = webLinks
    registerTerm(tab.id, term)

    // 把 PTY 尺寸同步给主进程（cols/rows 变化才发）
    const syncPtySize = () => {
      const { cols, rows } = term
      if (cols <= 0 || rows <= 0) return
      if (
        lastColsRowsRef.current?.cols === cols &&
        lastColsRowsRef.current?.rows === rows
      ) {
        return
      }
      lastColsRowsRef.current = { cols, rows }
      void resizeIpc({ terminalId: tab.id, cols, rows }).catch(() => {})
    }

    // webfont 可能晚于首 fit 就绪，行高度量失真会让最后一行被裁掉（表现为
    // “内容最后一节看不到”）；字体就绪后重 fit 一次修正。
    if (typeof document !== 'undefined' && document.fonts?.ready != null) {
      void document.fonts.ready.then(() => {
        if (termRef.current !== term) return
        requestAnimationFrame(() => {
          try {
            fit.fit()
            syncPtySize()
          } catch {
            // ignore
          }
        })
      })
    }

    // 剪贴板快捷键。macOS 上 ⌘C/⌘A/⌘V 通常已被应用菜单 accelerator 消费（主进程
    // 走 stream:app-menu:action 联动）；这里覆盖 Windows/Linux 及按键直达渲染端的
    // 场景。注意：Ctrl+C 无选区时必须放行，^C 才能继续作为 SIGINT 发给 PTY；
    // Ctrl+A 是 readline「跳行首」，只拦 ⌘A 不拦 Ctrl+A。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = isMac ? event.metaKey : event.ctrlKey
      if (!mod || event.altKey) return true
      const key = event.key.toLowerCase()
      if (key === 'c' && term.hasSelection()) {
        event.preventDefault()
        void navigator.clipboard.writeText(term.getSelection()).catch(() => {})
        return false
      }
      if (key === 'v') {
        event.preventDefault()
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text.length > 0) term.paste(text)
          })
          .catch(() => {})
        return false
      }
      if (key === 'a' && isMac) {
        event.preventDefault()
        term.selectAll()
        return false
      }
      return true
    })

    // 输入
    term.onData((data) => {
      // 非 active 时的输入会被忽略（用户应先点 tab）；但保留 onData 避免丢消息
      void inputIpc({ terminalId: tab.id, data }).catch((err: unknown) => {
        console.warn('[terminal] input failed:', err)
      })
    })

    setMounted(true)

    return () => {
      try {
        term.dispose()
      } catch {
        // ignore
      }
      termRef.current = null
      fitRef.current = null
      webLinksRef.current = null
      registerTerm(tab.id, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, registerTerm])

  // 主题切换：实时更新 xterm theme（不重建实例，保留 ring buffer）
  useEffect(() => {
    const term = termRef.current
    if (term == null || !mounted) return
    term.options.theme = resolvedTheme === 'dark' ? TERMINAL_THEME_DARK : TERMINAL_THEME_LIGHT
  }, [resolvedTheme, mounted])

  // active 切换：fit + 拉 buffer
  useEffect(() => {
    if (!isActive || !mounted) return
    const term = termRef.current
    const fit = fitRef.current
    if (term == null || fit == null) return
    // 等待容器可见再 fit
    requestAnimationFrame(() => {
      try {
        fit.fit()
        const { cols, rows } = term
        if (
          cols > 0 &&
          rows > 0 &&
          (lastColsRowsRef.current?.cols !== cols || lastColsRowsRef.current?.rows !== rows)
        ) {
          lastColsRowsRef.current = { cols, rows }
          void resizeIpc({ terminalId: tab.id, cols, rows }).catch(() => {})
        }
      } catch (err) {
        console.warn('[terminal] fit failed:', err)
      }
    })

    // 拉 buffer 补屏（仅在 PTY 已存在且有累积输出时）
    void getBuffer({ terminalId: tab.id })
      .then((res) => {
        if (res.output && res.output.length > 0 && termRef.current != null) {
          termRef.current.clear()
          termRef.current.write(res.output)
        }
      })
      .catch((err) => {
        console.warn('[terminal] getBuffer failed:', err)
      })
  }, [isActive, mounted, tab.id, getBuffer, resizeIpc])

  // ResizeObserver: 容器尺寸变化 → fit → resize
  useEffect(() => {
    if (!isActive || !mounted) return
    const container = containerRef.current
    if (container == null) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (timer != null) clearTimeout(timer)
      timer = setTimeout(() => {
        const term = termRef.current
        const fit = fitRef.current
        if (term == null || fit == null) return
        try {
          fit.fit()
          const { cols, rows } = term
          if (
            cols > 0 &&
            rows > 0 &&
            (lastColsRowsRef.current?.cols !== cols || lastColsRowsRef.current?.rows !== rows)
          ) {
            lastColsRowsRef.current = { cols, rows }
            void resizeIpc({ terminalId: tab.id, cols, rows }).catch(() => {})
          }
        } catch (err) {
          console.warn('[terminal] resize fit failed:', err)
        }
      }, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (timer != null) clearTimeout(timer)
    }
  }, [isActive, mounted, tab.id, resizeIpc])

  // stream: 写入 data / exit
  useIpcStream('stream:terminal:event', (event: TerminalStreamEvent) => {
    if (event.type === 'data') {
      if (event.sessionId !== sessionId) return
      if (event.terminalId !== tab.id) return
      const term = termRef.current
      if (term != null) {
        term.write(event.data)
      }
      return
    }
    if (event.type === 'exit') {
      if (event.sessionId !== sessionId) return
      if (event.terminalId !== tab.id) return
      const term = termRef.current
      if (term != null) {
        const codeText = event.exitCode != null ? `code=${event.exitCode}` : `signal=${event.signal ?? '?'}`
        term.write(`\r\n\x1b[2m[process exited (${codeText})]\x1b[0m\r\n`)
      }
      toast.info(`终端 ${tab.title} 已退出`)
      return
    }
    if (event.type === 'error') {
      if (event.terminalId != null && event.terminalId !== tab.id) return
      const term = termRef.current
      if (term != null) {
        term.write(`\r\n\x1b[31m[terminal error: ${event.message}]\x1b[0m\r\n`)
      }
      return
    }
  })

  // 右键菜单：定位点击 cell 所在逻辑行的 URL，连同选区状态交给面板渲染
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const term = termRef.current
    if (term == null) return
    const rowsEl = containerRef.current?.querySelector<HTMLElement>('.xterm-rows') ?? null
    const cell = rowsEl != null ? pickTerminalCell(term, e.clientX, e.clientY, rowsEl) : null
    const linkUrl = cell != null ? findLinkAtCell(term, cell) : null
    onContextMenuRequest({
      x: e.clientX,
      y: e.clientY,
      terminalId: tab.id,
      hasSelection: term.hasSelection(),
      linkUrl,
    })
  }

  return (
    <div
      ref={containerRef}
      className={`terminal-xterm ${isActive ? 'active' : ''}`}
      data-terminal-id={tab.id}
      onContextMenu={handleContextMenu}
    />
  )
}
