/**
 * 覆盖层组件：命令面板、权限弹窗
 *
 * CommandPalette — 三层命令架构面板：
 *   Layer 1: SDK 原生命令（Claude/Codex）
 *   Layer 2: 程序内置命令（Session/Model/Context/...）
 *   Layer 3: Agent 技能命令（Skill manifest）
 *   + UI 内置快捷命令（导航/操作）
 *   - 模糊搜索匹配
 *   - 最近使用命令优先排序
 *   - 快捷键提示 UI
 *
 * PermissionModal — 工具审批弹窗
 */
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { Input } from '@lobehub/ui'
import type { InputRef } from 'antd'
import { useToast } from '../components/Toast'
import { getShortcutLabel } from '../hooks/useKeyboard'
import type { ShortcutId } from '../hooks/useKeyboard'
import type {
  PermissionApprovalRequest,
  PermissionApprovalDecision,
  CommandListItem,
  CommandLayer,
  CommandRisk,
  CommandScope,
  SessionSearchResult,
  SessionId,
} from '@spark/protocol'
import { useSessionSidebar } from '../SessionSidebarContext'
import { PermissionRequestDetails } from '../components/PermissionRequestDetails'

/* ============================================================
   Types
   ============================================================ */

type CommandItem = {
  id: string
  name: string
  aliases: string[]
  layer: CommandLayer | 'ui'
  group: string
  description: string
  risk: CommandRisk | 'none'
  scope: CommandScope | 'app'
  palette?: CommandListItem['palette']
  usage?: string
  hasSubcommands?: boolean
  /** Optional shortcut ID for displaying keyboard hint */
  shortcutId?: ShortcutId | undefined
  /** Display shortcut hint directly (overrides shortcutId) */
  shortcutHint?: string
  /** Inline icon node (only used in global mode for sessions/menus). */
  iconNode?: ReactNode
  /** When set, executeCommand routes by kind instead of treating as a slash command. */
  kind?: 'command' | 'session' | 'menu'
}

type PaletteSection = {
  group: string
  layer: CommandLayer | 'ui'
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

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

/* ============================================================
   Recent commands persistence
   ============================================================ */

const RECENT_KEY = 'spark-agent:palette-recent'
const MAX_RECENT = 8

function buildSessionItems(
  lowerQuery: string,
  searchResults: SessionSearchResult[],
  recentSessions: Array<{ id: SessionId; title: string; updatedAt: string }>,
): CommandItem[] {
  if (lowerQuery) {
    return searchResults.slice(0, 8).map((r) => ({
      id: `session:${r.sessionId}`,
      name: r.title || '(无标题会话)',
      aliases: [],
      layer: 'ui' as const,
      group: 'session',
      description: r.snippet ? r.snippet.slice(0, 80) : '切换到该会话',
      risk: 'none' as const,
      scope: 'app' as const,
      iconNode: <Icons.MessageSquare />,
      kind: 'session' as const,
    }))
  }
  return recentSessions.slice(0, 8).map((s) => ({
    id: `session:${s.id}`,
    name: s.title || '(无标题会话)',
    aliases: [],
    layer: 'ui' as const,
    group: 'session',
    description: '切换到该会话',
    risk: 'none' as const,
    scope: 'app' as const,
    iconNode: <Icons.MessageSquare />,
    kind: 'session' as const,
  }))
}

function buildMenuItems(
  menuItems: Array<{
    id: string
    name: string
    description?: string
    icon?: ReactNode
  }>,
  lowerQuery: string,
): CommandItem[] {
  return menuItems
    .filter((m) => {
      if (!lowerQuery) return true
      const hay = `${m.name} ${m.description ?? ''} ${m.id}`.toLowerCase()
      return hay.includes(lowerQuery) || fuzzyScore(hay, lowerQuery) >= 0
    })
    .map((m) => ({
      id: `menu:${m.id}`,
      name: m.name,
      aliases: [],
      layer: 'ui' as const,
      group: 'menu',
      description: m.description ?? `跳转到「${m.name}」`,
      risk: 'none' as const,
      scope: 'app' as const,
      iconNode: m.icon ?? <Icons.ArrowRight />,
      kind: 'menu' as const,
    }))
}

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
    parts.push(
      <mark key="h" className="highlight-mark">
        {text.slice(idx, idx + query.length)}
      </mark>,
    )
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
        parts.push(
          <mark key={`h${chunkStart}`} className="highlight-mark">
            {text.slice(chunkStart, i)}
          </mark>,
        )
        chunkStart = i
        inMatch = false
      }
    }
  }

  // Flush remaining
  if (inMatch) {
    parts.push(
      <mark key={`h${chunkStart}`} className="highlight-mark">
        {text.slice(chunkStart)}
      </mark>,
    )
    if (chunkStart + (text.length - chunkStart) < text.length) {
      // nothing left
    }
  } else if (chunkStart < text.length) {
    parts.push(text.slice(chunkStart))
  }

  return qi === query.length ? <>{parts}</> : text
}

/* ============================================================
   Layer & Group helpers
   ============================================================ */

const LAYER_LABELS: Record<string, string> = {
  sdk: 'SDK 原生命令',
  builtin: '程序内置命令',
  skill: 'Agent 技能命令',
  ui: '快捷操作',
}

const GROUP_LABELS: Record<string, string> = {
  session: '会话',
  model: '模型',
  context: '上下文',
  permission: '权限',
  workflow: '工作流',
  agent: 'Agent',
  mcp: 'MCP',
  skill: '技能',
  resource: '资源',
  team: '团队',
  git: 'Git',
  utility: '工具',
  system: '系统',
  navigation: '导航',
  action: '操作',
  settings: '设置',
}

function getGroupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group
}

function getGroupIcon(group: string): ReactNode {
  const iconMap: Record<string, ReactNode> = {
    session: <Icons.Chat size={12} />,
    model: <Icons.Sparkles size={12} />,
    context: <Icons.File size={12} />,
    permission: <Icons.Shield size={12} />,
    workflow: <Icons.Workflow size={12} />,
    agent: <Icons.Agents size={12} />,
    mcp: <Icons.MCP size={12} />,
    skill: <Icons.Skills size={12} />,
    resource: <Icons.Cpu size={12} />,
    team: <Icons.Team size={12} />,
    git: <Icons.GitBranch size={12} />,
    utility: <Icons.Wrench size={12} />,
    system: <Icons.Settings size={12} />,
    navigation: <Icons.Compass size={12} />,
    action: <Icons.Command size={12} />,
    settings: <Icons.Settings size={12} />,
  }
  return iconMap[group] ?? <Icons.Command size={12} />
}

function getLayerBadgeColor(layer: CommandLayer | 'ui'): string {
  switch (layer) {
    case 'sdk':
      return 'var(--color-accent, #6366f1)'
    case 'builtin':
      return 'var(--color-success, #22c55e)'
    case 'skill':
      return 'var(--color-warning, #f59e0b)'
    case 'custom':
      return 'var(--primary, #165dff)'
    case 'ui':
      return 'var(--color-muted, #94a3b8)'
  }
}

function getRiskBadge(risk: CommandRisk | 'none'): ReactNode | null {
  if (risk === 'none' || risk === 'low') return null
  const colors: Record<string, string> = {
    medium: 'var(--color-warning, #f59e0b)',
    high: 'var(--color-error, #ef4444)',
  }
  return (
    <span
      className="badge"
      style={{
        marginLeft: 6,
        fontSize: 10,
        padding: '1px 5px',
        borderRadius: 3,
        background: colors[risk] ?? colors.medium,
        color: '#fff',
      }}
    >
      {risk === 'high' ? '危险' : '注意'}
    </span>
  )
}

/* ============================================================
   CommandPalette
   ============================================================ */

export function CommandPalette({
  onClose,
  onNavigate,
  onNewSession,
  onQuickTask,
  sessionContext = false,
  onInsertCommand,
  mode = 'command',
  menuItems,
}: {
  onClose: () => void
  /** Navigate to a view */
  onNavigate?: (view: string) => void
  /** Create a new session */
  onNewSession?: () => void
  /** Open the global quick task modal */
  onQuickTask?: () => void
  /** True when opened from the chat/session view. Session-scoped commands are only useful there. */
  sessionContext?: boolean
  /** Insert a slash command into the active conversation composer instead of executing it. */
  onInsertCommand?: (commandText: string) => void
  /** 'command' = command-only palette. 'global' = extend with sessions + menu navigation. */
  mode?: 'command' | 'global'
  /** Navigation menu items rendered in 'global' mode (last section). */
  menuItems?: Array<{
    id: string
    name: string
    description?: string
    icon?: ReactNode
  }>
}) {
  const [query, setQuery] = useState('')
  const [ipcCommands, setIpcCommands] = useState<CommandListItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<InputRef | null>(null)
  const { toast } = useToast()
  const isGlobal = mode === 'global'
  // Always call the hook so React's hook order is stable; in command mode we
  // simply ignore `sidebar`. The provider lives at the top of the renderer tree.
  const sidebar = useSessionSidebar()
  const [sessionSearch, setSessionSearch] = useState<SessionSearchResult[]>([])

  // Global mode: debounce session:search when query is non-empty. Stale results
  // are harmless because buildSessionItems only consults sessionSearch while
  // the query is non-empty, so we don't need to clear it on mode flip.
  useEffect(() => {
    if (!isGlobal) return
    const trimmed = query.trim()
    if (!trimmed) return
    const handle = window.setTimeout(() => {
      sidebar
        .searchSessions(trimmed)
        .then((results) => setSessionSearch(results))
        .catch(() => setSessionSearch([]))
    }, 180)
    return () => window.clearTimeout(handle)
  }, [query, isGlobal, sidebar])

  // Load IPC commands (three-layer)
  useEffect(() => {
    let cancelled = false
    window.spark
      .invoke('command:list', {})
      .then((res) => {
        if (!cancelled) {
          setIpcCommands(res.commands)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Built-in UI commands (shortcuts that appear in the palette)
  const uiCommands: UICmd[] = useMemo(
    () => [
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
        name: '连接器与 MCP 视图',
        description: '切换到连接器与 MCP 视图',
        category: 'navigation',
        shortcutId: 'viewMcp',
        execute: () => onNavigate?.('mcp'),
      },
      {
        id: 'ui:nav-providers',
        name: 'Providers 视图',
        description: '切换到 Providers 视图',
        category: 'navigation',
        execute: () => onNavigate?.('providers'),
      },
      {
        id: 'ui:nav-memory',
        name: '记忆视图',
        description: '查看与管理长期记忆（用户/项目/Agent 三层 + 检索/演化/整合设置）',
        category: 'navigation',
        execute: () => onNavigate?.('memory'),
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
        id: 'ui:quick-task',
        name: '快捷录入任务',
        description: '打开全局任务快捷录入浮窗',
        category: 'action',
        shortcutId: 'toggleSidebar',
        execute: () => onQuickTask?.(),
      },
      {
        id: 'ui:import-chat-history',
        name: '导入对话历史',
        description: '从宿主机 Claude Code / Codex 导入对话历史',
        category: 'settings',
        execute: () => sidebar.setHistoryImportOpen(true),
      },
    ],
    [onNavigate, onNewSession, onQuickTask, sidebar],
  )

  // Merge all commands: IPC three-layer + UI commands
  const allCommands = useMemo(() => {
    // Convert IPC commands (from backend registry)
    const ipcItems: CommandItem[] = ipcCommands.map((cmd) => {
      const item: CommandItem = {
        id: cmd.id,
        name: cmd.name,
        aliases: cmd.aliases ?? [],
        layer: cmd.layer,
        group: cmd.group,
        description: cmd.description,
        risk: cmd.risk,
        scope: cmd.scope,
        palette: cmd.palette,
      }
      if (cmd.usage !== undefined) item.usage = cmd.usage
      if (cmd.hasSubcommands !== undefined) item.hasSubcommands = cmd.hasSubcommands
      return item
    })
    // Convert UI commands
    const uiItems: CommandItem[] = uiCommands.map((cmd) => ({
      id: cmd.id,
      name: cmd.name,
      aliases: [],
      layer: 'ui' as const,
      group: cmd.category,
      description: cmd.description,
      risk: 'none' as const,
      scope: 'app' as const,
      shortcutId: cmd.shortcutId,
    }))
    const visibleIpcItems = ipcItems.filter((cmd) => cmd.palette?.hidden !== true)
    const contextAwareIpcItems = sessionContext
      ? visibleIpcItems
      : visibleIpcItems.filter((cmd) => cmd.scope === 'global' || cmd.scope === 'workspace')
    return [...contextAwareIpcItems, ...uiItems]
  }, [ipcCommands, uiCommands, sessionContext])

  // Filter, sort (recent first), and group by layer + group
  const filteredSections = useCallback((): PaletteSection[] => {
    const lowerQuery = query.toLowerCase().trim()
    const recentIds = loadRecentCommands()

    let filtered: CommandItem[]

    if (lowerQuery) {
      // Fuzzy search across name, description, aliases, group
      const scored = allCommands
        .map((cmd) => {
          const searchable = `${cmd.name} ${cmd.aliases.join(' ')} ${cmd.description} ${cmd.group} ${getGroupLabel(cmd.group)}`
          const score = fuzzyScore(searchable, lowerQuery)
          return { cmd, score }
        })
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.cmd)
      filtered = scored
    } else {
      // No query: show recent first, then all grouped by layer
      const recentSet = new Set(recentIds)
      const recentItems = recentIds
        .map((id) =>
          allCommands.find(
            (c) => c.name === id || c.id === id || `/${c.name}` === id || c.aliases.includes(id),
          ),
        )
        .filter((x): x is CommandItem => !!x)
      const rest = allCommands.filter(
        (c) => !recentSet.has(c.name) && !recentSet.has(`/${c.name}`) && !recentSet.has(c.id),
      )
      filtered = [...recentItems, ...rest]
    }

    if (filtered.length === 0 && !isGlobal) return []

    // Group by layer → group
    const sectionMap = new Map<string, PaletteSection>()
    const layerOrder: Array<CommandLayer | 'ui'> = ['sdk', 'builtin', 'skill', 'custom', 'ui']

    for (const cmd of filtered) {
      const layer = cmd.layer
      const group = cmd.group
      // If no query and in recent, put in a "最近使用" section
      const isRecent = !lowerQuery && recentIds.includes(cmd.name)
      const sectionKey = isRecent ? `recent` : `${layer}:${group}`
      const sectionLabel = isRecent
        ? '最近使用'
        : `${LAYER_LABELS[layer] ?? layer} › ${getGroupLabel(group)}`

      if (!sectionMap.has(sectionKey)) {
        sectionMap.set(sectionKey, { group: sectionLabel, layer, items: [] })
      }
      sectionMap.get(sectionKey)!.items.push(cmd)
    }

    // Sort sections: recent first, then by layer order, then by group
    const sections = Array.from(sectionMap.values())
    sections.sort((a, b) => {
      // Recent first
      if (a.group === '最近使用') return -1
      if (b.group === '最近使用') return 1
      // Then by layer order
      const aLayerIdx = layerOrder.indexOf(a.layer)
      const bLayerIdx = layerOrder.indexOf(b.layer)
      if (aLayerIdx !== bLayerIdx) return aLayerIdx - bLayerIdx
      // Then alphabetically by group
      return a.group.localeCompare(b.group)
    })

    // Global mode: surface 会话 first, then 命令 / 菜单.
    if (isGlobal) {
      const next: PaletteSection[] = []

      if (sidebar) {
        const sessionItems = buildSessionItems(lowerQuery, sessionSearch, sidebar.sessions)
        if (sessionItems.length > 0) {
          next.push({ group: '会话', layer: 'ui', items: sessionItems })
        }
      }

      if (filtered.length > 0) {
        next.push({ group: '命令', layer: 'ui', items: filtered })
      }

      if (menuItems && menuItems.length > 0) {
        const menuCmds = buildMenuItems(menuItems, lowerQuery)
        if (menuCmds.length > 0) {
          next.push({ group: '菜单', layer: 'ui', items: menuCmds })
        }
      }

      return next
    }

    return sections
  }, [allCommands, query, isGlobal, sidebar, sessionSearch, menuItems])

  // Flatten
  const flatItems = filteredSections().flatMap((s) => s.items)

  useEffect(() => {
    return deferEffect(() => setSelectedIndex(0))
  }, [query])

  useEffect(() => {
    return deferEffect(() => {
      if (flatItems.length > 0 && selectedIndex >= flatItems.length) {
        setSelectedIndex(flatItems.length - 1)
      }
    })
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
  const executeCommand = useCallback(
    async (cmd: CommandItem) => {
      // Global mode: route sessions and menu items by their kind, never run them as slash commands.
      if (cmd.kind === 'session' && cmd.id.startsWith('session:')) {
        const sessionId = cmd.id.slice('session:'.length) as SessionId
        sidebar?.setActiveSession(sessionId)
        onNavigate?.('chat')
        onClose()
        return
      }
      if (cmd.kind === 'menu' && cmd.id.startsWith('menu:')) {
        const viewId = cmd.id.slice('menu:'.length)
        onNavigate?.(viewId)
        onClose()
        return
      }

      saveRecentCommand(cmd.name)

      // Check if it's a UI command
      const uiCmd = uiCommands.find((c) => c.id === cmd.id)
      if (uiCmd) {
        uiCmd.execute()
        onClose()
        return
      }

      // In chat, slash commands are conversation actions: selecting them fills the composer.
      if (sessionContext && cmd.layer !== 'ui') {
        onInsertCommand?.(`/${cmd.name} `)
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
    },
    [query, toast, onClose, uiCommands, sessionContext, onInsertCommand, sidebar, onNavigate],
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
    },
    [flatItems, selectedIndex, executeCommand, onClose],
  )

  const sections = filteredSections()
  let flatIndex = 0

  const paletteHint = getShortcutLabel('openPalette')
  const placeholder = isGlobal
    ? '搜索命令、会话、菜单...'
    : sessionContext
      ? '搜索命令，选择后加入对话...'
      : '搜索应用级命令...'
  const emptyText = isGlobal ? '没有匹配的结果' : '没有匹配的命令'

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Icons.Search />
          <Input
            ref={inputRef}
            placeholder={placeholder}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="palette-results scroll" ref={resultsRef}>
          {loading && !isGlobal ? (
            <div className="palette-empty">
              <Icons.Spinner size={16} />
              <span>加载命令中...</span>
            </div>
          ) : sections.length === 0 ? (
            <div className="palette-empty">
              <span className="muted">{emptyText}</span>
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.group}>
                <div
                  className="palette-group"
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span>{section.group}</span>
                </div>
                {section.items.map((cmd) => {
                  const idx = flatIndex++
                  const isSelected = idx === selectedIndex
                  return (
                    <PaletteCommandItem
                      key={`${cmd.layer}:${cmd.id}`}
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
          <span className="seg">
            <span className="kbd">↑↓</span> 移动
          </span>
          <span className="seg">
            <span className="kbd">↵</span> 选择
          </span>
          <span className="seg">
            <span className="kbd">esc</span> 关闭
          </span>
          <div className="flex1" />
          <span className="seg muted">{paletteHint} · SparkWork</span>
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
  const icon = command.iconNode ?? getGroupIcon(command.group)
  const shortcutLabel = command.shortcutId
    ? getShortcutLabel(command.shortcutId)
    : (command.shortcutHint ?? '')
  const layerColor = getLayerBadgeColor(command.layer)

  return (
    <div
      className={`palette-item ${selected ? 'sel' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="ico">{icon}</span>
      <div className="body">
        <div className="title" style={{ display: 'flex', alignItems: 'center' }}>
          <span>{query ? highlightMatch(command.name, query) : command.name}</span>
          {getRiskBadge(command.risk)}
          {command.aliases.length > 0 && (
            <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>
              ({command.aliases.join(', ')})
            </span>
          )}
        </div>
        <div className="hint">{command.description}</div>
      </div>
      <div className="kbds" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 3,
            background: layerColor,
            color: '#fff',
            opacity: 0.7,
            whiteSpace: 'nowrap',
          }}
        >
          {command.layer === 'sdk'
            ? 'SDK'
            : command.layer === 'builtin'
              ? '内置'
              : command.layer === 'skill'
                ? '技能'
                : command.layer === 'custom'
                  ? '自定义'
                  : ''}
        </span>
        {shortcutLabel && (
          <span className="kbd" style={{ fontSize: 10 }}>
            {shortcutLabel}
          </span>
        )}
        {!shortcutLabel && command.usage && (
          <span className="kbd" style={{ fontSize: 10 }}>
            {command.usage}
          </span>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   PermissionModal
   ============================================================ */

export function PermissionModal({
  request,
  onClose,
}: {
  request: PermissionApprovalRequest
  onClose: () => void
}) {
  const riskIcon =
    request.riskLevel === 'high' ? (
      <Icons.AlertTriangle className="ico" />
    ) : (
      <Icons.Shield className="ico" />
    )
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]

  async function respond(decision: PermissionApprovalDecision) {
    try {
      await window.spark.invoke('permission:approval-respond', {
        requestId: request.requestId,
        decision,
      })
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
            <div className="modal-subtitle">
              Session {request.sessionId.slice(0, 8)} · 风险等级 {riskLabel}
            </div>
          </div>
        </div>
        <div className="modal-body">
          <PermissionRequestDetails request={request} />
        </div>
        <div className="modal-foot">
          <span className="muted overlay-muted-sm">
            <span className="kbd">esc</span> 拒绝
          </span>
          <div className="flex1" />
          <button className="btn" onClick={() => respond('deny')}>
            拒绝
          </button>
          <button className="btn" onClick={() => respond('deny-session')}>
            会话拒绝
          </button>
          <button className="btn" onClick={() => respond('allow-session')}>
            会话允许
          </button>
          <button className="btn primary" onClick={() => respond('allow-once')}>
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
