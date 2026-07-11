/**
 * HistoryImportModal — 检测并导入宿主机 Claude Code / Codex 对话历史。
 *
 * 三步交互：
 *   1. 扫描中    —— 打开即扫描两个来源
 *   2. 选择      —— 按来源分页 + 搜索 + 多选 + 右侧预览（已导入置灰）
 *   3. 导入/完成 —— 进度条 + 完成汇总（前往会话）
 *
 * UI 全部使用 lobe-ui 组件（Modal/Segmented/SearchBar/Checkbox/Tag/Button/Block/Empty），
 * 进度条用 antd Progress（lobe-ui 无对应组件）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, SearchBar, Segmented, Checkbox, Tag, Button, Block, Empty } from '@lobehub/ui'
import { Progress } from 'antd'
import type {
  HistoryImportItem,
  HistoryImportSource,
  HistoryImportProgress,
  HistoryImportPreviewMessage,
  HistoryImportResponse,
  HistoryImportSelection,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from './Toast'
import { useI18n } from '../i18n'
import { Icons } from '../Icons'
import './HistoryImportModal.less'

type Phase = 'scanning' | 'select' | 'importing' | 'done'

const SOURCE_LABEL: Record<HistoryImportSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
}

function formatTime(iso: string | null): string {
  if (iso == null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  const [sourceTab, setSourceTab] = useState<HistoryImportSource>('claude-code')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<HistoryImportProgress | null>(null)
  const [summary, setSummary] = useState<HistoryImportResponse | null>(null)
  const [previewItem, setPreviewItem] = useState<HistoryImportItem | null>(null)
  const [previewMsgs, setPreviewMsgs] = useState<HistoryImportPreviewMessage[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)

  const reset = useCallback(() => {
    setPhase('scanning')
    setItems([])
    setSearch('')
    setSelected(new Set())
    setProgress(null)
    setSummary(null)
    setPreviewItem(null)
    setPreviewMsgs([])
  }, [])

  const doScan = useCallback(async () => {
    setPhase('scanning')
    try {
      const res = await scan({})
      setItems(res.items)
      // 默认选中条目较多的来源页签
      const counts = res.sources.reduce<Record<string, number>>((acc, s) => {
        acc[s.source] = s.count
        return acc
      }, {})
      setSourceTab((counts['codex'] ?? 0) > (counts['claude-code'] ?? 0) ? 'codex' : 'claude-code')
      setPhase('select')
    } catch (err) {
      toast.error(`扫描失败：${err instanceof Error ? err.message : String(err)}`)
      ctx.setHistoryImportOpen(false)
    }
  }, [scan, toast, ctx])

  // 打开时扫描；关闭时重置
  useEffect(() => {
    if (open) {
      reset()
      void doScan()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useIpcStream('stream:history-import:progress', (p) => {
    setProgress(p)
  })

  const counts = useMemo(() => {
    let cc = 0
    let cx = 0
    for (const it of items) {
      if (it.source === 'claude-code') cc++
      else cx++
    }
    return { 'claude-code': cc, codex: cx }
  }, [items])

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase()
    return items.filter((it) => {
      if (it.source !== sourceTab) return false
      if (lower.length === 0) return true
      return (
        it.title.toLowerCase().includes(lower) ||
        it.project.toLowerCase().includes(lower) ||
        (it.cwd ?? '').toLowerCase().includes(lower)
      )
    })
  }, [items, sourceTab, search])

  const selectableVisible = useMemo(() => filtered.filter((it) => !it.alreadyImported), [filtered])
  const allSelected = selectableVisible.length > 0 && selectableVisible.every((it) => selected.has(it.filePath))
  const someSelected = selectableVisible.some((it) => selected.has(it.filePath)) && !allSelected

  const toggle = useCallback((filePath: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(filePath)
      else next.delete(filePath)
      return next
    })
  }, [])

  const toggleAll = useCallback((checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const it of selectableVisible) {
        if (checked) next.add(it.filePath)
        else next.delete(it.filePath)
      }
      return next
    })
  }, [selectableVisible])

  const loadPreview = useCallback(async (it: HistoryImportItem) => {
    setPreviewItem(it)
    setPreviewLoading(true)
    setPreviewMsgs([])
    try {
      const res = await preview({ source: it.source, filePath: it.filePath, limit: 30 })
      setPreviewMsgs(res.messages)
    } catch (err) {
      toast.error(`预览失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPreviewLoading(false)
    }
  }, [preview, toast])

  const doImport = useCallback(async () => {
    const selections: HistoryImportSelection[] = items
      .filter((it) => selected.has(it.filePath) && !it.alreadyImported)
      .map((it) => ({
        source: it.source,
        filePath: it.filePath,
        sourceSessionId: it.sourceSessionId,
        cwd: it.cwd,
        title: it.title,
      }))
    if (selections.length === 0) return
    setPhase('importing')
    setProgress({ phase: 'parsing', current: 0, total: selections.length })
    try {
      const res = await runImport({ selections })
      setSummary(res)
      setPhase('done')
      await ctx.refreshData()
      if (res.imported > 0) toast.success(`成功导入 ${res.imported} 个会话`)
    } catch (err) {
      toast.error(`导入失败：${err instanceof Error ? err.message : String(err)}`)
      setPhase('select')
    }
  }, [items, selected, runImport, ctx, toast])

  const close = useCallback(() => ctx.setHistoryImportOpen(false), [ctx])

  const selectedCount = selected.size

  return (
    <Modal
      open={open}
      title={t('app.sidebar.importHistory')}
      onCancel={close}
      footer={null}
      width={880}
      destroyOnHidden
      centered
      className="history-import-modal"
    >
      {phase === 'scanning' && (
        <div className="hi-state hi-scanning" aria-live="polite">
          <div className="hi-scan-visual" aria-hidden="true">
            <span className="hi-scan-ring hi-scan-ring-outer" />
            <span className="hi-scan-ring hi-scan-ring-inner" />
            <span className="hi-scan-beam" />
            <span className="hi-scan-center"><Icons.Search size={22} /></span>
          </div>
          <div className="hi-state-title">正在扫描宿主机对话历史…</div>
          <div className="hi-state-desc">检测 Claude Code 与 Codex 的本地会话记录</div>
          <div className="hi-scan-sources"><span>Claude Code</span><span>Codex</span></div>
        </div>
      )}

      {phase === 'select' && (
        <div className="hi-select">
          <div className="hi-overview">
            <div><strong>{items.length}</strong><span>个会话已找到</span></div>
            <span className="hi-overview-note">已导入的会话会自动跳过</span>
          </div>
          <div className="hi-toolbar">
            <Segmented
              value={sourceTab}
              onChange={(v) => {
                setSourceTab(v as HistoryImportSource)
                setPreviewItem(null)
              }}
              options={[
                { label: `Claude Code (${counts['claude-code']})`, value: 'claude-code' },
                { label: `Codex (${counts.codex})`, value: 'codex' },
              ]}
            />
            <SearchBar
              value={search}
              onChange={(e) => setSearch((e.target as HTMLInputElement).value)}
              placeholder="搜索标题 / 项目…"
              style={{ flex: 1 }}
            />
          </div>

          <div className="hi-body">
            <div className="hi-list">
              <div className="hi-list-head">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onChange={(checked) => toggleAll(Boolean(checked))}
                >
                  全选（{selectableVisible.length}）
                </Checkbox>
              </div>
              <div className="hi-list-body">
                {filtered.length === 0 ? (
                  <Empty description={search ? '没有匹配的会话' : '该来源暂无可导入的历史'} />
                ) : (
                  filtered.map((it) => {
                    const checked = selected.has(it.filePath)
                    const isActive = previewItem?.filePath === it.filePath
                    return (
                      <div
                        key={it.filePath}
                        className={`hi-row${isActive ? ' is-active' : ''}${it.alreadyImported ? ' is-imported' : ''}`}
                        onClick={() => void loadPreview(it)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          void loadPreview(it)
                        }}
                      >
                        <div className="hi-row-check" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={checked}
                            disabled={it.alreadyImported}
                            onChange={(c) => toggle(it.filePath, Boolean(c))}
                          />
                        </div>
                        <div className="hi-row-main">
                          <div className="hi-row-title">
                            <span className="hi-row-title-text">{it.title}</span>
                            {it.alreadyImported && <Tag className="hi-tag-imported">已导入</Tag>}
                          </div>
                          <div className="hi-row-meta">
                            <span className="hi-row-project">{it.project}</span>
                            <span className="hi-dot">·</span>
                            <span>{it.messageCount} 条消息</span>
                            {it.lastTimestamp && (
                              <>
                                <span className="hi-dot">·</span>
                                <span>{formatTime(it.lastTimestamp)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="hi-preview">
              {previewItem == null ? (
                <div className="hi-preview-empty">点击左侧会话查看预览</div>
              ) : (
                <>
                  <div className="hi-preview-head">
                    <div className="hi-preview-heading">
                      <span className="hi-preview-kicker">会话预览</span>
                      <span className="hi-preview-title">{previewItem.title}</span>
                    </div>
                    <Tag>{SOURCE_LABEL[previewItem.source]}</Tag>
                  </div>
                  {previewItem.cwd && <div className="hi-preview-cwd">{previewItem.cwd}</div>}
                  <div className="hi-preview-body">
                    {previewLoading ? (
                      <div className="hi-preview-loading">加载中…</div>
                    ) : (
                      previewMsgs.map((m, i) => (
                        <div key={i} className={`hi-msg hi-msg-${m.role}`}>
                          <span className="hi-msg-role">{roleLabel(m.role)}</span>
                          <div className="hi-msg-bubble"><span className="hi-msg-text">{m.text}</span></div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="hi-footer">
            <div className="hi-footer-left">
              <Tag className="hi-tag-count">{selectedCount} 已选</Tag>
            </div>
            <div className="hi-footer-right">
              <Button onClick={close}>取消</Button>
              <Button type="primary" disabled={selectedCount === 0} onClick={() => void doImport()}>
                导入所选
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="hi-state">
          <div className="hi-state-title">正在导入…</div>
          <Progress
            percent={progress != null && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}
            status="active"
          />
          <div className="hi-state-desc">
            {progress != null ? `${progress.current} / ${progress.total}` : ''}
            {progress?.currentTitle ? ` · ${progress.currentTitle}` : ''}
          </div>
        </div>
      )}

      {phase === 'done' && summary != null && (
        <div className="hi-state">
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

function roleLabel(role: HistoryImportPreviewMessage['role']): string {
  switch (role) {
    case 'user':
      return '用户'
    case 'assistant':
      return '助手'
    case 'thinking':
      return '思考'
    case 'tool':
      return '工具'
    default:
      return role
  }
}
