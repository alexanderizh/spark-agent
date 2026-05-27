/**
 * 覆盖层组件：命令面板、权限弹窗
 *
 * CommandPalette — 增强版命令面板：
 *   - IPC 驱动命令 + UI 内置快捷命令
 *   - 命令分组（导航/操作/设置）
 *   - 模糊搜索匹配
 *   - 最近使用命令优先排序
 *   - 快捷键提示 UI
 *
 * PermissionModal — 工具审批弹窗
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { SparkInput } from '../components/FormControls'
import { useToast } from '../components/Toast'
import { getShortcutLabel, DEFAULT_SHORTCUTS, formatShortcut } from '../hooks/useKeyboard'
import type { ShortcutId } from '../hooks/useKeyboard'
import type { PermissionApprovalRequest, PermissionApprovalDecision } from '@spark/protocol'

/* ============================================================
   Types
   ============================================================ */

type CommandItem = {
  name: string
  description: string
  category: string
  usage?: string
  isDangerous?: boolean
  /** Optional shortcut ID for displaying keyboard hint */
  shortcutId?: ShortcutId | undefined
  /** Display shortcut hint directly (overrides shortcutId) */
  shortcutHint?: string
}

type PaletteSection = {
  group: string
  items: CommandItem[]
}

type UICmd = {
  id: string
  name: string
  description: string
  category: string
  shortcutId?: ShortcutId
  shortcutHint?: string
  execute: () => void | Promise<void>
}

/* ============================================================
   Recent commands persistence
   ============================================================ */

const RECENT_KEY = 'spark-agent:palette-recent'
const MAX_RECENT = 8

function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveRecentCommand(id: string): void {
  try {
    const prev = loadRecentCommands().filter((x) => x !== id)
    prev.unshift(id)
    localStorage.setItem(RECENT_KEY, JSON.stringify(prev.slice(0, MAX_RECENT)))
  } catch {
    // ignore
  }
}

/* ============================================================
   Fuzzy match
   ============================================================ */

/** Returns a score (higher = better match), or -1 if no match */
function fuzzyScore(text: string, query: string): number {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()

  // Exact substring match gets highest score
  const exactIdx = lower.indexOf(q)
  if (exactIdx !== -1) {
    // Bonus for matching at start
    return 100 + (exactIdx === 0 ? 50 : 0)
  }

  // Character-by-character fuzzy match
  let qi = 0
  let score = 0
  let lastMatchIdx = -2

  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      score += 10
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) score += 15
      // Bonus for matching at word boundary
      if (i === 0 || lower[i - 1] === ' ' || lower[i - 1] === '/' || lower[i - 1] === '_') {
        score += 20
      }
      lastMatchIdx = i
      qi++
    }
  }

  return qi === q.length ? score : -1
}

function fuzzyMatch(text: string, query: string): boolean {
  return fuzzyScore(text, query) >= 0
}

/* ============================================================
   Highlight Match
   ============================================================ */

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()

  // Try exact substring highlight first
  const idx = lowerText.indexOf(lowerQuery)
  if (idx !== -1) {
    const parts: ReactNode[] = []
    if (idx > 0) parts.push(text.slice(0, idx))
    parts.push(<mark key="h" className="highlight-mark">{text.slice(idx, idx + query.length)}</mark>)
    if (idx + query.length < text.length) parts.push(text.slice(idx + query.length))
    return <>{parts}</>
  }

  // Fuzzy highlight: bold the matched chars
  const parts: ReactNode[] = []
  let qi = 0
  let chunkStart = 0
  let inMatch = false

  for (let i = 0; i < text.length && qi < query.length; i++) {
    const tc = text[i]
    const qc = query[qi]
    if (tc && qc && tc.toLowerCase() === qc.toLowerCase()) {
      if (!inMatch) {
        if (chunkStart < i) parts.push(text.slice(chunkStart, i))
        chunkStart = i
        inMatch = true
      }
      qi++
    } else {
      if (inMatch) {
        parts.push(<mark key={`h${chunkStart}`} className="highlight-mark">{text.slice(chunkStart, i)}</mark>)
        chunkStart = i
        inMatch = false
      }
    }
  }

  // Flush remaining
  if (inMatch) {
    parts.push(<mark key={`h${chunkStart}`} className="highlight-mark">{text.slice(chunkStart)}</mark>)
    if (chunkStart + (text.length - chunkStart) < text.length) {
      // nothing left
    }
  } else if (chunkStart < text.length) {
    parts.push(text.slice(chunkStart))
  }

  return qi === query.length ? <>{parts}</> : text
}

/* ============================================================
   CommandPalette
   ============================================================ */

export function CommandPalette({
  onClose,
  onNavigate,
  onNewSession,
}: {
  onClose: () => void
  /** Navigate to a view */
  onNavigate?: (view: string) => void
  /** Create a new session */
  onNewSession?: () => void
}) {
  const [query, setQuery] = useState('')
  const [ipcCommands, setIpcCommands] = useState<CommandItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  // Load IPC commands
  useEffect(() => {
    let cancelled = false
    window.spark.invoke('command:list', {})
      .then((res) => {
        if (!cancelled) {
          setIpcCommands(res.commands)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  // Built-in UI commands (shortcuts that appear in the palette)
  const uiCommands: UICmd[] = useMemo(() => [
    {
      id: 'ui:nav-home',
      name: 'Home 视图',
      description: '切换到 Home 视图',
      category: 'navigation',
      shortcutId: 'viewHome',
      execute: () => onNavigate?.('home'),
    },
    {
      id: 'ui:nav-chat',
      name: 'Chat 视图',
      description: '切换到 Chat 视图',
      category: 'navigation',
      shortcutId: 'viewChat',
      execute: () => onNavigate?.('chat'),
    },
    {
      id: 'ui:nav-workflows',
      name: 'Workflows 视图',
      description: '切换到 Workflows 视图',
      category: 'navigation',
      shortcutId: 'viewWorkflows',
      execute: () => onNavigate?.('workflows'),
    },
    {
      id: 'ui:nav-agents',
      name: 'Agents 视图',
      description: '切换到 Agents 视图',
      category: 'navigation',
      shortcutId: 'viewAgents',
      execute: () => onNavigate?.('agents'),
    },
    {
      id: 'ui:nav-skills',
      name: 'Skills 视图',
      description: '切换到 Skills 视图',
      category: 'navigation',
      shortcutId: 'viewSkills',
      execute: () => onNavigate?.('skills'),
    },
    {
      id: 'ui:nav-mcp',
      name: 'MCP 视图',
      description: '切换到 MCP 视图',
      category: 'navigation',
      shortcutId: 'viewMcp',
      execute: () => onNavigate?.('mcp'),
    },
    {
      id: 'ui:nav-settings',
      name: 'Settings 视图',
      description: '切换到 Settings 视图',
      category: 'settings',
      shortcutId: 'openSettings',
      execute: () => onNavigate?.('settings'),
    },
    {
      id: 'ui:new-session',
      name: '新建会话',
      description: '创建一个新的聊天会话',
      category: 'action',
      shortcutId: 'newSession',
      execute: () => onNewSession?.(),
    },
    {
      id: 'ui:toggle-sidebar',
      name: '切换侧边栏',
      description: '折叠/展开侧边栏',
      category: 'action',
      shortcutId: 'toggleSidebar',
      execute: () => onNavigate?.('__toggleSidebar'),
    },
  ], [onNavigate, onNewSession])

  // Merge all commands: UI commands + IPC commands
  const allCommands = useMemo(() => {
    const ipcItems: CommandItem[] = ipcCommands.map((cmd) => ({
      ...cmd,
      category: cmd.category || 'general',
    }))
    const uiItems: CommandItem[] = uiCommands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      category: cmd.category,
      shortcutId: cmd.shortcutId,
    }))
    return [...uiItems, ...ipcItems]
  }, [ipcCommands, uiCommands])

  // Filter, sort (recent first), and group
  const filteredSections = useCallback((): PaletteSection[] => {
    const lowerQuery = query.toLowerCase().trim()
    const recentIds = loadRecentCommands()

    let filtered: CommandItem[]

    if (lowerQuery) {
      // Fuzzy search
      const scored = allCommands
        .map((cmd) => {
          const searchable = `${cmd.name} ${cmd.description} ${cmd.category}`
          const score = fuzzyScore(searchable, lowerQuery)
          return { cmd, score }
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.cmd)
      filtered = scored
    } else {
      // No query: show recent first, then all
      const recentSet = new Set(recentIds)
      const recentItems = recentIds
        .map((id) => allCommands.find((c) => c.name === id || `/${c.name}` === id || id === `ui:${c.category}`))
        .filter((x): x is CommandItem => !!x)
      const rest = allCommands.filter((c) => !recentSet.has(c.name) && !recentSet.has(`/${c.name}`))
      filtered = [...recentItems, ...rest]
    }

    if (filtered.length === 0) return []

    // Group by enhanced category
    const groupMap = new Map<string, CommandItem[]>()
    for (const cmd of filtered) {
      const group = getEnhancedCategoryLabel(cmd.category, lowerQuery ? undefined : recentIds)
      const items = groupMap.get(group) ?? []
      items.push(cmd)
      groupMap.set(group, items)
    }

    const sections: PaletteSection[] = []
    for (const [group, items] of groupMap) {
      sections.push({ group, items })
    }
    return sections
  }, [allCommands, query])

  // Flatten
  const flatItems = filteredSections().flatMap((s) => s.items)

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    if (flatItems.length > 0 && selectedIndex >= flatItems.length) {
      setSelectedIndex(flatItems.length - 1)
    }
  }, [flatItems.length, selectedIndex])

  // Scroll selected into view
  useEffect(() => {
    const container = resultsRef.current
    if (!container) return
    const selectedEl = container.querySelector('.palette-item.sel') as HTMLElement | null
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Execute command
  const executeCommand = useCallback(async (cmd: CommandItem) => {
    saveRecentCommand(cmd.name)

    // Check if it's a UI command
    const uiCmd = uiCommands.find((c) => c.name === cmd.name)
    if (uiCmd) {
      uiCmd.execute()
      onClose()
      return
    }

    // IPC command
    const fullCommand = query.trim() || `/${cmd.name}`
    try {
      const res = await window.spark.invoke('command:execute', {
        sessionId: '__palette__',
        message: fullCommand,
      })
      if (res.success) {
        toast.success(res.message || `/${cmd.name} 执行成功`)
      } else {
        toast.error(res.message || `/${cmd.name} 执行失败`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `执行 /${cmd.name} 失败`)
    }
    onClose()
  }, [query, toast, onClose, uiCommands])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(flatItems.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + flatItems.length) % Math.max(flatItems.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = flatItems[selectedIndex]
      if (cmd) void executeCommand(cmd)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [flatItems, selectedIndex, executeCommand, onClose])

  const sections = filteredSections()
  let flatIndex = 0

  const paletteHint = getShortcutLabel('openPalette')

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Icons.Search />
          <SparkInput
            ref={inputRef}
            placeholder="搜索命令..."
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results scroll" ref={resultsRef}>
          {loading ? (
            <div className="palette-empty">
              <Icons.Spinner size={16} />
              <span>加载命令中...</span>
            </div>
          ) : sections.length === 0 ? (
            <div className="palette-empty">
              <span className="muted">没有匹配的命令</span>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.group}>
                <div className="palette-group">{section.group}</div>
                {section.items.map((cmd) => {
                  const idx = flatIndex++
                  const isSelected = idx === selectedIndex
                  return (
                    <PaletteCommandItem
                      key={`${cmd.category}:${cmd.name}`}
                      command={cmd}
                      selected={isSelected}
                      query={query.trim()}
                      onClick={() => void executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    />
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span className="seg"><span className="kbd">↑↓</span> 移动</span>
          <span className="seg"><span className="kbd">↵</span> 选择</span>
          <span className="seg"><span className="kbd">esc</span> 关闭</span>
          <div className="flex1" />
          <span className="seg muted">{paletteHint} · Spark Agent</span>
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   PaletteCommandItem
   ============================================================ */

function PaletteCommandItem({
  command,
  selected,
  query,
  onClick,
  onMouseEnter,
}: {
  command: CommandItem
  selected: boolean
  query: string
  onClick: () => void
  onMouseEnter: () => void
}) {
  const icon = getEnhancedCategoryIcon(command.category)
  const shortcutLabel = command.shortcutId
    ? getShortcutLabel(command.shortcutId)
    : command.shortcutHint ?? ''
  const displayCommand = command.name.startsWith('ui:') ? command.name.replace('ui:', '') : `/${command.name}`

  return (
    <div
      className={`palette-item ${selected ? 'sel' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="ico">{icon}</span>
      <div className="body">
        <div className="title">
          {query ? highlightMatch(command.name, query) : command.name}
          {command.isDangerous && <span className="badge danger" style={{ marginLeft: 6 }}>危险</span>}
        </div>
        <div className="hint">{command.description}</div>
      </div>
      {(shortcutLabel || command.usage) && (
        <div className="kbds">
          {shortcutLabel && <span className="kbd" style={{ fontSize: 10 }}>{shortcutLabel}</span>}
          {!shortcutLabel && command.usage && (
            <span className="kbd" style={{ fontSize: 10 }}>{command.usage}</span>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Enhanced category helpers
   ============================================================ */

function getEnhancedCategoryLabel(category: string, recentIds?: string[]): string {
  if (recentIds) {
    // When not searching, we use a "最近使用" group marker
    // Handled in filteredSections
  }
  const labels: Record<string, string> = {
    general: '通用',
    model: '模型',
    session: '会话',
    workspace: '工作区',
    debug: '调试',
    navigation: '导航',
    action: '操作',
    settings: '设置',
  }
  return labels[category] ?? category
}

function getEnhancedCategoryIcon(category: string): ReactNode {
  const iconMap: Record<string, ReactNode> = {
    general: <Icons.Command size={12} />,
    model: <Icons.Sparkles size={12} />,
    session: <Icons.Chat size={12} />,
    workspace: <Icons.Folder size={12} />,
    debug: <Icons.Terminal size={12} />,
    navigation: <Icons.Compass size={12} />,
    action: <Icons.Command size={12} />,
    settings: <Icons.Settings size={12} />,
  }
  return iconMap[category] ?? <Icons.Command size={12} />
}

/* ============================================================
   PermissionModal
   ============================================================ */

export function PermissionModal({ request, onClose }: { request: PermissionApprovalRequest; onClose: () => void }) {
  const riskIcon = request.riskLevel === 'high' ? <Icons.AlertTriangle className="ico" /> : <Icons.Shield className="ico" />
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]

  async function respond(decision: PermissionApprovalDecision) {
    try {
      await window.spark.invoke('permission:approval-respond', { requestId: request.requestId, decision })
    } catch {
      // best-effort
    }
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={() => respond('deny')}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon">{riskIcon}</div>
          <div>
            <div className="modal-title">请求执行工具：{request.toolName}</div>
            <div className="modal-subtitle">Session {request.sessionId.slice(0, 8)} · 风险等级 {riskLabel}</div>
          </div>
        </div>
        <div className="modal-body">
          <div className="cmd-preview mono-sm">
            {JSON.stringify(request.toolInput, null, 2)}
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted overlay-muted-sm">
            <span className="kbd">esc</span> 拒绝
          </span>
          <div className="flex1" />
          <button className="btn" onClick={() => respond('deny')}>拒绝</button>
          <button className="btn" onClick={() => respond('allow-session')}>本会话允许</button>
          <button className="btn primary" onClick={() => respond('allow-once')}>允许一次</button>
        </div>
      </div>
    </div>
  )
}
