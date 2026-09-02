/**
 * HistoryImportModal — 检测并导入宿主机 Claude Code / Codex 对话历史。
 *
 * 交互阶段：
 *   1. 扫描中    —— 并行扫描各来源（codex / claude-code / zcode），展示来源状态与实时发现数量
 *   2. 选择      —— 虚拟列表 + 搜索/项目/时间筛选 + 完整对话预览
 *   3. 导入/完成 —— 进度反馈 + 完成汇总
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import {
  Block,
  Button,
  Checkbox,
  Empty,
  Modal,
  SearchBar,
  Segmented,
  Select,
  Tag,
} from '@lobehub/ui'
import { Progress } from 'antd'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  HistoryImportItem,
  HistoryImportPreviewMessage,
  HistoryImportProgress,
  HistoryImportResponse,
  HistoryImportSelection,
  HistoryImportSource,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from './Toast'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import './HistoryImportModal.less'

type Phase = 'scanning' | 'select' | 'importing' | 'done'
type TimeFilter = 'all' | '7' | '30' | '90'
type ScanStatus = 'scanning' | 'done' | 'unavailable'

type ScanSourceState = {
  status: ScanStatus
  count: number
  rootPath: string
  error?: string
}

const SOURCE_LABEL: Record<HistoryImportSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  zcode: 'ZCode',
}

/**
 * 条目唯一键：source + sourceSessionId。
 * 不能用 filePath——zcode CLI 多个会话共享同一个 sqlite 库文件路径。
 */
const itemKey = (item: { source: HistoryImportSource; sourceSessionId: string }): string =>
  `${item.source}:${item.sourceSessionId}`

const TIME_FILTER_OPTIONS = [
  { label: '全部时间', value: 'all' },
  { label: '最近 7 天', value: '7' },
  { label: '最近 30 天', value: '30' },
  { label: '最近 90 天', value: '90' },
]

const EMPTY_SCAN_STATE: Record<HistoryImportSource, ScanSourceState> = {
  'claude-code': { status: 'scanning', count: 0, rootPath: '~/.claude/projects' },
  codex: { status: 'scanning', count: 0, rootPath: '~/.codex/sessions' },
  zcode: { status: 'scanning', count: 0, rootPath: '~/.zcode' },
}

function freshScanState(): Record<HistoryImportSource, ScanSourceState> {
  return {
    'claude-code': { ...EMPTY_SCAN_STATE['claude-code'] },
    codex: { ...EMPTY_SCAN_STATE.codex },
    zcode: { ...EMPTY_SCAN_STATE.zcode },
  }
}

function formatTime(iso: string | null): string {
  if (iso == null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRowTime(iso: string | null): string {
  if (iso == null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (targetStart === dayStart) return `今天 ${time}`
  if (targetStart === dayStart - 86_400_000) return `昨天 ${time}`
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return formatTime(iso)
}

function formatMessageTime(iso: string | null): string {
  if (iso == null) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

export function HistoryImportModal() {
  const ctx = useSessionSidebar()
  const open = ctx.historyImportOpen
  const { toast } = useToast()
  const { t } = useI18n()
  const { invoke: scan } = useIpcInvoke('history-import:scan')
  const { invoke: preview } = useIpcInvoke('history-import:preview')
  const { invoke: runImport } = useIpcInvoke('history-import:import')

  const [phase, setPhase] = useState<Phase>('scanning')
  const [items, setItems] = useState<HistoryImportItem[]>([])
  const [sourceTab, setSourceTab] = useState<HistoryImportSource>('codex')
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [showImported, setShowImported] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<HistoryImportProgress | null>(null)
  const [summary, setSummary] = useState<HistoryImportResponse | null>(null)
  const [scanSources, setScanSources] =
    useState<Record<HistoryImportSource, ScanSourceState>>(freshScanState)
  const [previewItem, setPreviewItem] = useState<HistoryImportItem | null>(null)
  const [previewMsgs, setPreviewMsgs] = useState<HistoryImportPreviewMessage[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewTruncated, setPreviewTruncated] = useState(false)
  const [userOnly, setUserOnly] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const scanRequestRef = useRef(0)
  const previewRequestRef = useRef(0)

  const reset = useCallback(() => {
    setPhase('scanning')
    setItems([])
    setSearch('')
    setProjectFilter('all')
    setTimeFilter('all')
    setShowImported(false)
    setSelected(new Set())
    setProgress(null)
    setSummary(null)
    setScanSources(freshScanState())
    setPreviewItem(null)
    setPreviewMsgs([])
    setPreviewTruncated(false)
    setUserOnly(false)
    setPreviewExpanded(false)
  }, [])

  const doScan = useCallback(async () => {
    const requestId = ++scanRequestRef.current
    previewRequestRef.current++
    setPhase('scanning')
    setScanSources(freshScanState())
    const startedAt = Date.now()

    const scanOne = async (source: HistoryImportSource) => {
      try {
        const response = await scan({ sources: [source] })
        const sourceSummary = response.sources.find((entry) => entry.source === source)
        if (requestId === scanRequestRef.current) {
          setScanSources((current) => ({
            ...current,
            [source]: {
              status: sourceSummary?.available === false ? 'unavailable' : 'done',
              count: sourceSummary?.count ?? response.items.length,
              rootPath: sourceSummary?.rootPath ?? current[source].rootPath,
              ...(sourceSummary?.error != null ? { error: sourceSummary.error } : {}),
            },
          }))
        }
        return response
      } catch (error) {
        if (requestId === scanRequestRef.current) {
          setScanSources((current) => ({
            ...current,
            [source]: {
              ...current[source],
              status: 'unavailable',
              error: error instanceof Error ? error.message : String(error),
            },
          }))
        }
        throw error
      }
    }

    try {
      const settled = await Promise.allSettled([
        scanOne('claude-code'),
        scanOne('codex'),
        scanOne('zcode'),
      ])
      const responses = settled.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      if (responses.length === 0) {
        const reason = settled.find((result) => result.status === 'rejected')
        throw reason?.status === 'rejected' ? reason.reason : new Error('没有可用的会话来源')
      }

      const nextItems = responses
        .flatMap((response) => response.items)
        .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''))
      const minimumDuration = 720
      const remaining = minimumDuration - (Date.now() - startedAt)
      if (remaining > 0) await wait(remaining)
      if (requestId !== scanRequestRef.current) return
      setItems(nextItems)
      // 默认落在有条目的来源上（与 Tab 顺序一致：codex > claude-code > zcode）
      const codexCount = nextItems.filter((item) => item.source === 'codex').length
      const claudeCount = nextItems.filter((item) => item.source === 'claude-code').length
      setSourceTab(codexCount > 0 ? 'codex' : claudeCount > 0 ? 'claude-code' : 'zcode')
      setPhase('select')
    } catch (error) {
      if (requestId !== scanRequestRef.current) return
      toast.error(`扫描失败：${error instanceof Error ? error.message : String(error)}`)
      ctx.setHistoryImportOpen(false)
    }
  }, [ctx, scan, toast])

  useEffect(() => {
    if (open) {
      reset()
      void doScan()
    } else {
      scanRequestRef.current++
      previewRequestRef.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useIpcStream('stream:history-import:progress', (nextProgress) => {
    setProgress(nextProgress)
  })

  const counts = useMemo(() => {
    const result: Record<HistoryImportSource, number> = { 'claude-code': 0, codex: 0, zcode: 0 }
    for (const item of items) result[item.source]++
    return result
  }, [items])

  const importableCount = useMemo(
    () => items.filter((item) => !item.alreadyImported).length,
    [items],
  )
  const importedCount = items.length - importableCount

  const projects = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .filter((item) => item.source === sourceTab)
            .map((item) => item.project || 'no-project'),
        ),
      ).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [items, sourceTab],
  )

  const sourceOptions = useMemo(
    () => [
      { label: `Codex ${counts.codex.toLocaleString()}`, value: 'codex' },
      { label: `Claude Code ${counts['claude-code'].toLocaleString()}`, value: 'claude-code' },
      { label: `ZCode ${counts.zcode.toLocaleString()}`, value: 'zcode' },
    ],
    [counts],
  )

  const projectOptions = useMemo(
    () => [
      { label: '全部项目', value: 'all' },
      ...projects.map((project) => ({ label: project, value: project })),
    ],
    [projects],
  )

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase()
    const cutoff = timeFilter === 'all' ? null : Date.now() - Number(timeFilter) * 86_400_000

    return items.filter((item) => {
      if (item.source !== sourceTab) return false
      if (!showImported && item.alreadyImported) return false
      if (projectFilter !== 'all' && item.project !== projectFilter) return false
      if (cutoff != null) {
        const timestamp =
          item.lastTimestamp == null ? Number.NaN : new Date(item.lastTimestamp).getTime()
        if (!Number.isFinite(timestamp) || timestamp < cutoff) return false
      }
      if (lower.length === 0) return true
      return (
        item.title.toLowerCase().includes(lower) ||
        item.project.toLowerCase().includes(lower) ||
        item.sourceSessionId.toLowerCase().includes(lower) ||
        (item.cwd ?? '').toLowerCase().includes(lower)
      )
    })
  }, [items, projectFilter, search, showImported, sourceTab, timeFilter])

  const selectableVisible = useMemo(
    () => filtered.filter((item) => !item.alreadyImported),
    [filtered],
  )
  const allSelected =
    selectableVisible.length > 0 && selectableVisible.every((item) => selected.has(itemKey(item)))
  const someSelected = selectableVisible.some((item) => selected.has(itemKey(item))) && !allSelected

  const selectedStats = useMemo(
    () =>
      items.reduce(
        (result, item) =>
          selected.has(itemKey(item))
            ? {
                messages: result.messages + item.messageCount,
                bytes: result.bytes + item.sizeBytes,
              }
            : result,
        { messages: 0, bytes: 0 },
      ),
    [items, selected],
  )

  const visiblePreviewMsgs = useMemo(
    () => (userOnly ? previewMsgs.filter((message) => message.role === 'user') : previewMsgs),
    [previewMsgs, userOnly],
  )

  const listVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 78,
    overscan: 10,
  })

  useEffect(() => {
    listScrollRef.current?.scrollTo({ top: 0 })
  }, [projectFilter, search, showImported, sourceTab, timeFilter])

  const toggle = useCallback((key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected((current) => {
        const next = new Set(current)
        for (const item of selectableVisible) {
          if (checked) next.add(itemKey(item))
          else next.delete(itemKey(item))
        }
        return next
      })
    },
    [selectableVisible],
  )

  const loadPreview = useCallback(
    async (item: HistoryImportItem, loadAll = false) => {
      const requestId = ++previewRequestRef.current
      setPreviewItem(item)
      setPreviewLoading(true)
      setPreviewMsgs([])
      setPreviewTruncated(false)
      setUserOnly(false)
      if (previewScrollRef.current != null) previewScrollRef.current.scrollTop = 0
      try {
        const previewLimit = loadAll ? 100_000 : Math.max(500, item.messageCount * 6 + 100)
        const response = await preview({
          source: item.source,
          filePath: item.filePath,
          sourceSessionId: item.sourceSessionId,
          ...(item.origin != null ? { origin: item.origin } : {}),
          limit: previewLimit,
        })
        if (requestId !== previewRequestRef.current) return
        setPreviewMsgs(response.messages)
        setPreviewTruncated(response.truncated)
      } catch (error) {
        if (requestId !== previewRequestRef.current) return
        toast.error(`预览失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (requestId === previewRequestRef.current) setPreviewLoading(false)
      }
    },
    [preview, toast],
  )

  const doImport = useCallback(async () => {
    const selections: HistoryImportSelection[] = items
      .filter((item) => selected.has(itemKey(item)) && !item.alreadyImported)
      .map((item) => ({
        source: item.source,
        filePath: item.filePath,
        sourceSessionId: item.sourceSessionId,
        ...(item.origin != null ? { origin: item.origin } : {}),
        cwd: item.cwd,
        title: item.title,
      }))
    if (selections.length === 0) return
    setPhase('importing')
    setProgress({ phase: 'parsing', current: 0, total: selections.length })
    try {
      const response = await runImport({ selections })
      setSummary(response)
      setPhase('done')
      await ctx.refreshData()
      if (response.imported > 0) toast.success(`成功导入 ${response.imported} 个会话`)
    } catch (error) {
      toast.error(`导入失败：${error instanceof Error ? error.message : String(error)}`)
      setPhase('select')
    }
  }, [ctx, items, runImport, selected, toast])

  const close = useCallback(() => ctx.setHistoryImportOpen(false), [ctx])
  const selectedCount = selected.size
  const discoveredCount =
    scanSources['claude-code'].count + scanSources.codex.count + scanSources.zcode.count
  const scanningSource = (['codex', 'zcode', 'claude-code'] as HistoryImportSource[]).find(
    (key) => scanSources[key].status === 'scanning',
  )
  const scanPathText =
    scanningSource != null
      ? `正在读取 ${scanSources[scanningSource].rootPath}/…`
      : `正在整理 ${scanSources['claude-code'].rootPath}/…`
  const importingPercent =
    progress != null && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0
  const modalTitle = useMemo(
    () => (
      <div className="hi-modal-title">
        <span className="hi-modal-title-icon">
          <Icons.ListFilter size={19} />
        </span>
        <span>
          <strong>{t('app.sidebar.importHistory')}</strong>
          <small>
            {phase === 'scanning'
              ? '正在读取本地索引，不会上传任何会话内容'
              : '选择需要导入的本地会话，可在右侧完整预览'}
          </small>
        </span>
      </div>
    ),
    [phase, t],
  )

  return (
    <Modal
      open={open}
      title={modalTitle}
      onCancel={close}
      footer={null}
      width={1440}
      destroyOnHidden
      centered
      className={classNames('history-import-modal', `is-phase-${phase}`)}
      // @lobehub/ui Modal 默认会通过 inline styles.body 注入 paddingInline:16
      // 与 maxHeight:75dvh / overflow:hidden auto，会覆盖 less 里的 padding:0 并破坏
      // flex 高度链。这里显式置空，让 less 的 .ant-modal-body 样式生效。
      paddings={{ desktop: 0 }}
      styles={{ body: { padding: 0, maxHeight: 'none', overflow: 'unset' } }}
    >
      {phase === 'scanning' && (
        <div className="hi-scan-state" aria-live="polite">
          <div className="hi-scan-heading">
            <h2>正在检索本机会话</h2>
            <p>并行扫描 Codex、Claude Code 与 ZCode，本地解析后生成可预览列表</p>
          </div>
          <div className="hi-scan-flow" aria-hidden="true">
            <ScanSourceCard source="codex" state={scanSources.codex} />
            <ScanSourceCard source="claude-code" state={scanSources['claude-code']} />
            <ScanSourceCard source="zcode" state={scanSources.zcode} />
            <div className="hi-scan-lines hi-scan-lines-top">
              <i />
              <i />
              <i />
            </div>
            <div className="hi-scan-lines hi-scan-lines-middle">
              <i />
              <i />
              <i />
            </div>
            <div className="hi-scan-lines hi-scan-lines-bottom">
              <i />
              <i />
              <i />
            </div>
            <div className="hi-scan-collector">
              <span>
                <Icons.Database size={27} />
              </span>
            </div>
            <div className="hi-scan-result-line" />
            <div className="hi-scan-results">
              <span />
              <span />
              <span />
            </div>
          </div>
          <div className="hi-scan-count">
            <strong>{discoveredCount.toLocaleString()}</strong>
            <span>个会话已发现</span>
          </div>
          <div className="hi-scan-path">{scanPathText}</div>
          <div className="hi-scan-progress">
            <span />
          </div>
          <div className="hi-scan-statuses">
            <ScanStatusLabel source="codex" state={scanSources.codex} />
            <ScanStatusLabel source="claude-code" state={scanSources['claude-code']} />
            <ScanStatusLabel source="zcode" state={scanSources.zcode} />
            <span>完成后自动进入选择页面</span>
          </div>
          <p className="hi-scan-hint">可随时关闭，已扫描结果不会自动导入</p>
        </div>
      )}

      {phase === 'select' && (
        <div className="hi-select">
          <div className="hi-controls">
            <div className="hi-overview">
              <div className="hi-overview-total">
                <strong>{items.length.toLocaleString()}</strong>
              </div>
              <i />
              <div className="hi-overview-detail">
                <strong>{importableCount.toLocaleString()} 个可导入</strong>
                <span>{importedCount.toLocaleString()} 个已存在 · 默认隐藏</span>
              </div>
            </div>
            <div className="hi-toolbar">
              <Segmented
                value={sourceTab}
                onChange={(value) => {
                  previewRequestRef.current++
                  setSourceTab(value as HistoryImportSource)
                  setProjectFilter('all')
                  setPreviewItem(null)
                  setPreviewMsgs([])
                  setPreviewExpanded(false)
                }}
                options={sourceOptions}
              />
              <SearchBar
                value={search}
                onChange={(event) => setSearch((event.target as HTMLInputElement).value)}
                placeholder="搜索标题、项目或路径…"
                className="hi-search"
              />
              <Select
                aria-label="项目筛选"
                className="hi-filter-select hi-project-filter"
                size="small"
                value={projectFilter}
                onChange={(value) => setProjectFilter(value as string)}
                options={projectOptions}
              />
              <Select
                aria-label="时间筛选"
                className="hi-filter-select hi-time-filter"
                size="small"
                value={timeFilter}
                onChange={(value) => setTimeFilter(value as TimeFilter)}
                options={TIME_FILTER_OPTIONS}
              />
              <label className="hi-show-imported">
                <Checkbox
                  checked={showImported}
                  onChange={(checked) => setShowImported(Boolean(checked))}
                />
                <span>显示已导入</span>
              </label>
            </div>
          </div>

          <div className={classNames('hi-body', previewExpanded && 'is-preview-expanded')}>
            <div className="hi-list">
              <div className="hi-list-head">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(checked) => toggleAll(Boolean(checked))}
                >
                  选择当前结果
                </Checkbox>
                <span>{selectableVisible.length.toLocaleString()} 个可选</span>
              </div>
              <div ref={listScrollRef} className="hi-list-body">
                {filtered.length === 0 ? (
                  <Empty description={search ? '没有匹配的会话' : '当前筛选下没有可导入会话'} />
                ) : (
                  <div
                    className="hi-virtual-list"
                    style={{ height: listVirtualizer.getTotalSize() }}
                  >
                    {listVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = filtered[virtualRow.index]
                      if (item == null) return null
                      const checked = selected.has(itemKey(item))
                      const isActive = previewItem != null && itemKey(previewItem) === itemKey(item)
                      return (
                        <div
                          key={itemKey(item)}
                          ref={listVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="hi-row-shell"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <div
                            className={classNames(
                              'hi-row',
                              isActive && 'is-active',
                              item.alreadyImported && 'is-imported',
                            )}
                          >
                            <div className="hi-row-check">
                              <Checkbox
                                checked={checked}
                                disabled={item.alreadyImported}
                                onChange={(value) => toggle(itemKey(item), Boolean(value))}
                              />
                            </div>
                            <button
                              type="button"
                              className="hi-row-open"
                              aria-label={`预览会话：${item.title || '未命名会话'}`}
                              onClick={() => void loadPreview(item)}
                            >
                              <div className="hi-row-main">
                                <div className="hi-row-title">
                                  <span>{item.title || '未命名会话'}</span>
                                  {item.alreadyImported && (
                                    <Tag className="hi-tag-imported">已导入</Tag>
                                  )}
                                </div>
                                <div className="hi-row-meta">
                                  <span className="hi-row-project">
                                    {item.project || 'no-project'}
                                  </span>
                                  <span>·</span>
                                  <span>{item.messageCount.toLocaleString()} 条消息</span>
                                  <span>·</span>
                                  <span>{SOURCE_LABEL[item.source]}</span>
                                </div>
                              </div>
                              <time className="hi-row-time">
                                {formatRowTime(item.lastTimestamp)}
                              </time>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="hi-preview">
              {previewItem == null ? (
                <div className="hi-preview-empty">
                  <span>
                    <Icons.MessageSquare size={24} />
                  </span>
                  <strong>选择一个会话查看完整内容</strong>
                  <p>预览不会导入或修改原始会话</p>
                </div>
              ) : (
                <>
                  <div className="hi-preview-head">
                    <div className="hi-preview-title-row">
                      <div className="hi-preview-heading">
                        <span className="hi-preview-kicker">会话预览</span>
                        <strong>{previewItem.title || '未命名会话'}</strong>
                      </div>
                      <div className="hi-preview-actions">
                        <Button size="small" onClick={() => setUserOnly((current) => !current)}>
                          {userOnly ? '显示全部消息' : '仅看用户消息'}
                        </Button>
                        <Button
                          size="small"
                          onClick={() => setPreviewExpanded((current) => !current)}
                        >
                          <Icons.ExternalLink size={13} />
                          {previewExpanded ? '退出专注预览' : '专注预览'}
                        </Button>
                      </div>
                    </div>
                    <div className="hi-preview-meta">
                      <Tag>{SOURCE_LABEL[previewItem.source]}</Tag>
                      <Tag>{previewItem.project || 'no-project'}</Tag>
                      <span>{previewItem.messageCount.toLocaleString()} 条消息</span>
                      <span>{formatTime(previewItem.lastTimestamp)}</span>
                      {previewItem.cwd && (
                        <span className="hi-preview-cwd">
                          <Icons.Folder size={12} />
                          {previewItem.cwd}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="hi-preview-toolbar">
                    <span className="hi-role-legend">
                      <i className="is-user" />
                      用户
                    </span>
                    <span className="hi-role-legend">
                      <i className="is-assistant" />
                      助手
                    </span>
                    <span className="hi-role-legend">
                      <i />
                      工具 / 思考
                    </span>
                    <span className="hi-preview-toolbar-note">内容可完整滚动 · 不再截断消息</span>
                  </div>
                  <div ref={previewScrollRef} className="hi-preview-body">
                    {previewLoading ? (
                      <div className="hi-preview-loading">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : visiblePreviewMsgs.length === 0 ? (
                      <Empty
                        description={userOnly ? '该会话没有用户消息' : '该会话没有可预览的文本消息'}
                      />
                    ) : (
                      <>
                        <div className="hi-thread-line" />
                        {visiblePreviewMsgs.map((message, index) => (
                          <div
                            key={`${message.timestamp ?? 'message'}-${index}`}
                            className={classNames('hi-msg', `hi-msg-${message.role}`)}
                          >
                            <span className="hi-msg-avatar">{roleShortLabel(message.role)}</span>
                            <div className="hi-msg-content">
                              <div className="hi-msg-head">
                                <strong>{roleLabel(message.role)}</strong>
                                <time>{formatMessageTime(message.timestamp)}</time>
                              </div>
                              <div className="hi-msg-bubble">
                                <span className="hi-msg-text">{message.text}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                        {previewTruncated && (
                          <div className="hi-preview-truncated">
                            <span>
                              该会话较长，当前仅展示前 {previewMsgs.length.toLocaleString()} 条
                            </span>
                            <Button
                              size="small"
                              onClick={() => void loadPreview(previewItem, true)}
                            >
                              加载完整会话
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="hi-footer">
            <div className="hi-selection-summary">
              <strong>{selectedCount}</strong>
              <span>已选择 {selectedCount.toLocaleString()} 个会话</span>
              {selectedCount > 0 && (
                <small>
                  共 {selectedStats.messages.toLocaleString()} 条消息 · 约{' '}
                  {formatBytes(selectedStats.bytes)}
                </small>
              )}
              {selectedCount > 0 && (
                <button type="button" onClick={() => setSelected(new Set())}>
                  清空选择
                </button>
              )}
            </div>
            <div className="hi-footer-actions">
              <Button onClick={close}>取消</Button>
              <Button type="primary" disabled={selectedCount === 0} onClick={() => void doImport()}>
                <Icons.Download size={15} />
                导入 {selectedCount.toLocaleString()} 个会话
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="hi-state hi-importing" aria-live="polite">
          <span className="hi-state-icon">
            <Icons.Download size={24} />
          </span>
          <div className="hi-state-title">正在导入会话</div>
          <div className="hi-import-progress">
            <Progress percent={importingPercent} status="active" />
          </div>
          <div className="hi-state-desc">
            {progress != null ? `${progress.current} / ${progress.total}` : ''}
            {progress?.currentTitle ? ` · ${progress.currentTitle}` : ''}
          </div>
        </div>
      )}

      {phase === 'done' && summary != null && (
        <div className="hi-state hi-done">
          <span className="hi-state-icon is-success">
            <Icons.CheckCircle size={26} />
          </span>
          <div className="hi-state-title">导入完成</div>
          <Block variant="outlined" className="hi-summary">
            <div className="hi-summary-row">
              <span>成功导入</span>
              <strong>{summary.imported}</strong>
            </div>
            {summary.skipped > 0 && (
              <div className="hi-summary-row">
                <span>跳过（已导入）</span>
                <strong>{summary.skipped}</strong>
              </div>
            )}
            {summary.failed > 0 && (
              <div className="hi-summary-row hi-summary-failed">
                <span>失败</span>
                <strong>{summary.failed}</strong>
              </div>
            )}
          </Block>
          <div className="hi-state-actions">
            <Button onClick={() => void doScan()}>继续导入</Button>
            <Button type="primary" onClick={close}>
              完成
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ScanSourceCard({
  source,
  state,
}: {
  source: HistoryImportSource
  state: ScanSourceState
}) {
  return (
    <div className={classNames('hi-scan-source', `hi-scan-source-${source}`)}>
      <div className="hi-scan-source-head">
        <span className="hi-scan-source-icon">
          <Icons.Terminal size={16} />
        </span>
        <span>
          <strong>{SOURCE_LABEL[source]}</strong>
          <small>
            {state.status === 'scanning'
              ? '扫描会话索引'
              : state.status === 'done'
                ? '扫描完成'
                : '来源不可用'}
          </small>
        </span>
        <b>{state.count > 0 ? state.count.toLocaleString() : '—'}</b>
      </div>
      <div className={classNames('hi-scan-source-progress', `is-${state.status}`)}>
        <span />
      </div>
    </div>
  )
}

function ScanStatusLabel({
  source,
  state,
}: {
  source: HistoryImportSource
  state: ScanSourceState
}) {
  return (
    <span className={classNames('hi-scan-status', `is-${state.status}`)} title={state.error}>
      <i />
      {SOURCE_LABEL[source]} ·{' '}
      {state.status === 'scanning' ? '正在检索' : state.status === 'done' ? '已完成' : '不可用'}
    </span>
  )
}

function roleLabel(role: HistoryImportPreviewMessage['role']): string {
  switch (role) {
    case 'user':
      return '用户'
    case 'assistant':
      return 'Spark Agent'
    case 'thinking':
      return '思考'
    case 'tool':
      return '工具'
    default:
      return role
  }
}

function roleShortLabel(role: HistoryImportPreviewMessage['role']): string {
  switch (role) {
    case 'user':
      return '你'
    case 'assistant':
      return 'AI'
    case 'thinking':
      return '思'
    case 'tool':
      return '工'
    default:
      return ''
  }
}
