/**
 * 覆盖层组件：命令面板、权限弹窗
 *
 * CommandPalette — 真实 IPC 驱动的命令面板：
 *   - command:list 获取所有可用命令
 *   - command:execute 执行命令
 *   - command:parse 解析命令文本
 *   - 搜索过滤 + 键盘导航
 *   - 执行结果通过 Toast 展示
 *
 * PermissionModal — 工具审批弹窗
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { SparkInput } from '../components/FormControls'
import { useToast } from '../components/Toast'
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
}

type PaletteSection = {
  group: string
  items: CommandItem[]
}

/* ============================================================
   CommandPalette
   ============================================================ */

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const resultsRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { toast } = useToast()

  // 加载命令列表
  useEffect(() => {
    let cancelled = false
    window.spark.invoke('command:list', {})
      .then((res) => {
        if (!cancelled) {
          setCommands(res.commands)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('加载命令列表失败', err)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  // 过滤命令并分组
  const filteredSections = useCallback((): PaletteSection[] => {
    const lowerQuery = query.toLowerCase().trim()
    const filtered = lowerQuery
      ? commands.filter((cmd) =>
          cmd.name.toLowerCase().includes(lowerQuery) ||
          cmd.description.toLowerCase().includes(lowerQuery) ||
          cmd.category.toLowerCase().includes(lowerQuery),
        )
      : commands

    if (filtered.length === 0) return []

    // 按 category 分组
    const groupMap = new Map<string, CommandItem[]>()
    for (const cmd of filtered) {
      const group = getCategoryLabel(cmd.category)
      const items = groupMap.get(group) ?? []
      items.push(cmd)
      groupMap.set(group, items)
    }

    const sections: PaletteSection[] = []
    for (const [group, items] of groupMap) {
      sections.push({ group, items })
    }
    return sections
  }, [commands, query])

  // 扁平化后的所有可见项（用于 index 导航）
  const flatItems = filteredSections().flatMap((s) => s.items)

  // 当过滤结果变化时重置 selectedIndex
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 确保 selectedIndex 不越界
  useEffect(() => {
    if (flatItems.length > 0 && selectedIndex >= flatItems.length) {
      setSelectedIndex(flatItems.length - 1)
    }
  }, [flatItems.length, selectedIndex])

  // 滚动选中项到可视区域
  useEffect(() => {
    const container = resultsRef.current
    if (!container) return
    const selectedEl = container.querySelector('.palette-item.sel') as HTMLElement | null
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // 执行命令
  const executeCommand = useCallback(async (cmd: CommandItem) => {
    // 需要参数的命令（如 /model, /approval）在搜索框输入完整命令
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
  }, [query, toast, onClose])

  // 键盘导航
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

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Icons.Search />
          <SparkInput
            ref={inputRef}
            placeholder="搜索或输入命令..."
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
                      key={cmd.name}
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
          <span className="seg muted">⌘K · Spark Agent</span>
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
  const icon = getCategoryIcon(command.category)
  return (
    <div
      className={`palette-item ${selected ? 'sel' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span className="ico">{icon}</span>
      <div className="body">
        <div className="title">
          {query ? highlightMatch(`/${command.name}`, query) : `/${command.name}`}
          {command.isDangerous && <span className="badge danger" style={{ marginLeft: 6 }}>危险</span>}
        </div>
        <div className="hint">{command.description}</div>
      </div>
      {command.usage && (
        <div className="kbds">
          <span className="kbd" style={{ fontSize: 10 }}>{command.usage}</span>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Highlight Match
   ============================================================ */

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lowerText.indexOf(lowerQuery)
  if (idx === -1) return text

  const parts: ReactNode[] = []
  if (idx > 0) parts.push(text.slice(0, idx))
  parts.push(<mark key="h" className="highlight-mark">{text.slice(idx, idx + query.length)}</mark>)
  if (idx + query.length < text.length) parts.push(text.slice(idx + query.length))
  return <>{parts}</>
}

/* ============================================================
   Helpers
   ============================================================ */

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    general: '通用',
    model: '模型',
    session: '会话',
    workspace: '工作区',
    debug: '调试',
  }
  return labels[category] ?? category
}

function getCategoryIcon(category: string): ReactNode {
  const iconMap: Record<string, ReactNode> = {
    general: <Icons.Command size={12} />,
    model: <Icons.Sparkles size={12} />,
    session: <Icons.Chat size={12} />,
    workspace: <Icons.Folder size={12} />,
    debug: <Icons.Terminal size={12} />,
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
