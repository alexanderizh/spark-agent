/**
 * WikiCandidatePanel — 候选确认区（S2 抽取管道的人工晋级闸门）。
 *
 * 设计纪律：
 *   - **扁平分组**：行与行之间用 1px 分割线，不用盒子卡片（仓库 UI 约定）；
 *   - **所见即所存**：确认时必须回传列表渲染时的 digest（payload 摘要绑定），
 *     因此 digest 由父层随条目一起下发，本组件不做二次计算；
 *   - **模型自称确认无效**：本组件只发结构化 IPC（wiki:candidate:confirm）；
 *   - 展开正文 / 依据片段才会读取内容，默认只显示标题 + 摘要（渐进披露）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Select, Spin } from 'antd'
import type { WikiCandidateItem, WikiExtractionReceipt, WikiSpaceSummary } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { MarkdownText } from '../chat/ChatMarkdown'

const KIND_LABEL: Record<string, string> = {
  knowledge: '知识',
  experience: '经验',
  pattern: '模式',
  reference: '参考',
  note: '随笔',
}

const KIND_DOT: Record<string, string> = {
  knowledge: 'k-knowledge',
  experience: 'k-experience',
  pattern: 'k-pattern',
  reference: 'k-reference',
  note: 'k-note',
}

const RECEIPT_TEXT: Record<string, string> = {
  disabled: '沉淀开关未开启，可在知识库设置里打开',
  no_provider: '没有可用的抽取模型渠道',
  dialogue_empty: '这段对话没有可沉淀的内容',
  model_failed: '抽取模型调用失败',
  invalid_output: '抽取输出不可用',
  quota: '候选区已满，请先处理待确认候选',
}

export interface WikiCandidatePanelProps {
  spaces: WikiSpaceSummary[]
  /** 会话列表（供「从对话沉淀」选择；由父层加载） */
  sessions: Array<{ id: string; title: string; turnCount?: number }>
  sessionsLoading: boolean
  onRefreshSessions: () => void
  onPromoted: () => void
}

export function WikiCandidatePanel({
  spaces,
  sessions,
  sessionsLoading,
  onRefreshSessions,
  onPromoted,
}: WikiCandidatePanelProps) {
  const { toast } = useToast()
  const { invoke: listCandidates } = useIpcInvoke('wiki:candidate:list')
  const { invoke: confirmCandidate } = useIpcInvoke('wiki:candidate:confirm')
  const { invoke: rejectCandidate } = useIpcInvoke('wiki:candidate:reject')
  const { invoke: distill } = useIpcInvoke('wiki:extract:distill')

  const [items, setItems] = useState<WikiCandidateItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [targetSpace, setTargetSpace] = useState<Record<number, string>>({})
  const [distillOpen, setDistillOpen] = useState(false)
  const [pickedSession, setPickedSession] = useState<string | null>(null)
  const [distilling, setDistilling] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listCandidates({ status: 'pending' })
      setItems(res.items)
    } catch (err) {
      toast.error(`候选区加载失败：${errorText(err)}`)
    } finally {
      setLoading(false)
    }
  }, [listCandidates, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const manualSpaces = useMemo(() => spaces.filter((s) => !s.archived), [spaces])

  const handleConfirm = useCallback(
    async (item: WikiCandidateItem) => {
      setBusyId(item.id)
      try {
        const spaceId = targetSpace[item.id]
        await confirmCandidate({
          id: item.id,
          digest: item.digest,
          ...(spaceId != null ? { spaceId } : {}),
        })
        toast.success(`已沉淀为页面：${item.title}`)
        onPromoted()
        await refresh()
      } catch (err) {
        toast.error(`晋级失败：${errorText(err)}`)
        // 失败后候选可能已回滚为 pending：重取一次，避免界面停留在假象上
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [confirmCandidate, onPromoted, refresh, targetSpace, toast],
  )

  const handleReject = useCallback(
    async (item: WikiCandidateItem) => {
      setBusyId(item.id)
      try {
        await rejectCandidate({ id: item.id })
        toast.success('已拒绝，该候选不再提醒')
        await refresh()
      } catch (err) {
        toast.error(`拒绝失败：${errorText(err)}`)
      } finally {
        setBusyId(null)
      }
    },
    [rejectCandidate, toast, refresh],
  )

  const handleDistill = useCallback(async () => {
    if (pickedSession == null) {
      toast.error('请先选择一个会话')
      return
    }
    setDistilling(true)
    try {
      const receipt = (await distill({
        sessionId: pickedSession,
        trigger: 'manual',
      })) as WikiExtractionReceipt
      if (!receipt.ok) {
        toast.error(RECEIPT_TEXT[receipt.reason ?? ''] ?? receipt.message ?? '沉淀失败')
        return
      }
      if (receipt.inserted === 0) {
        toast.info(
          receipt.sampledTurns === 0
            ? '这段对话没有新增可沉淀的内容'
            : '抽取到的内容与既有候选重复',
        )
      } else {
        toast.success(`新增 ${receipt.inserted} 条候选，待你确认`)
      }
      setDistillOpen(false)
      await refresh()
    } catch (err) {
      toast.error(`沉淀失败：${errorText(err)}`)
    } finally {
      setDistilling(false)
    }
  }, [distill, pickedSession, refresh, toast])

  return (
    <div className="wiki_body">
      <div className="wiki_results_head">
        候选区 · <b>{items.length}</b> 条待确认
        <span className="wiki_rail_spacer" />
        <button
          type="button"
          className="wiki_btn_primary"
          style={{ height: 26 }}
          onClick={() => {
            onRefreshSessions()
            setDistillOpen(true)
          }}
        >
          <Icons.Sparkles size={13} />
          从对话沉淀
        </button>
        <button
          type="button"
          className="wiki_btn_ghost"
          style={{ height: 26 }}
          onClick={() => void refresh()}
        >
          刷新
        </button>
      </div>

      {loading ? (
        <div className="wiki_empty" style={{ minHeight: 200 }}>
          <Spin size="small" />
        </div>
      ) : items.length === 0 ? (
        <div className="wiki_empty">
          <div className="wiki_empty_title">没有待确认的候选</div>
          <div className="wiki_empty_desc">
            抽取产物会先落到候选区，经你确认后才成为知识页。点「从对话沉淀」把一段对话归纳成候选。
          </div>
        </div>
      ) : (
        <div className="wiki_cand_list">
          {items.map((item) => {
            const expanded = expandedId === item.id
            const busy = busyId === item.id
            return (
              <div key={item.id} className="wiki_cand_row">
                <div className="wiki_cand_head">
                  <span
                    className={`wiki_tree_dot ${KIND_DOT[item.kind] ?? 'k-note'}`}
                    aria-hidden
                  />
                  <span className="wiki_cand_title">{item.title}</span>
                  <span className="wiki_cand_kind">{KIND_LABEL[item.kind] ?? '随笔'}</span>
                  {item.confidence < 0.6 && (
                    <span className="wiki_cand_lowconf" title="模型自评置信度较低，请仔细核对依据">
                      模型推断
                    </span>
                  )}
                </div>
                {item.summary.length > 0 && <div className="wiki_cand_summary">{item.summary}</div>}
                <div className="wiki_cand_meta">
                  {item.tags.length > 0 && <span>{item.tags.join(' · ')}</span>}
                  <span>置信度 {item.confidence.toFixed(2)}</span>
                  <span>依据 {item.sources.length} 条</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>

                {expanded && (
                  <div className="wiki_cand_detail">
                    <div className="wiki_cand_detail_label">正文预览</div>
                    <div className="wiki_cand_preview">
                      <MarkdownText content={item.body} />
                    </div>
                    <div className="wiki_cand_detail_label">依据片段</div>
                    <ul className="wiki_cand_sources">
                      {item.sources.map((source, index) => (
                        <li key={`${source.sessionId}-${source.turnIndex}-${index}`}>
                          <span className="wiki_cand_source_turn">第 {source.turnIndex} 轮</span>
                          {source.excerpt}
                        </li>
                      ))}
                    </ul>
                    {item.rationale != null && item.rationale.length > 0 && (
                      <div className="wiki_cand_rationale">入选理由：{item.rationale}</div>
                    )}
                  </div>
                )}

                <div className="wiki_cand_actions">
                  <button
                    type="button"
                    className="wiki_btn_ghost"
                    style={{ height: 26 }}
                    onClick={() => setExpandedId(expanded ? null : item.id)}
                  >
                    {expanded ? '收起' : '查看依据与正文'}
                  </button>
                  <span className="wiki_rail_spacer" />
                  {manualSpaces.length > 1 && (
                    <Select
                      size="small"
                      style={{ width: 150 }}
                      placeholder="目标空间"
                      value={targetSpace[item.id] ?? null}
                      options={manualSpaces.map((s) => ({ value: s.id, label: s.name }))}
                      onChange={(value: string) =>
                        setTargetSpace((prev) => ({ ...prev, [item.id]: value }))
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="wiki_btn_ghost"
                    style={{ height: 26 }}
                    disabled={busy}
                    onClick={() => void handleReject(item)}
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    className="wiki_btn_primary"
                    style={{ height: 26 }}
                    disabled={busy}
                    onClick={() => void handleConfirm(item)}
                  >
                    确认晋级
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        className="wiki_modal"
        title="从对话沉淀"
        open={distillOpen}
        onCancel={() => setDistillOpen(false)}
        onOk={() => void handleDistill()}
        confirmLoading={distilling}
        okText="开始沉淀"
        cancelText="取消"
      >
        <p className="wiki_cand_modal_desc">
          选择一段会话，抽取器会只处理新增轮次，把结论、根因、可复用流程归纳成候选。
          产物先进入候选区，经你确认后才成为知识页。
        </p>
        {sessionsLoading ? (
          <Spin size="small" />
        ) : (
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="搜索并选择会话"
            value={pickedSession}
            options={sessions.map((s) => ({
              value: s.id,
              label: s.title.length > 0 ? s.title : '未命名会话',
            }))}
            filterOption={(input, option) =>
              String(option?.label ?? '')
                .toLowerCase()
                .includes(input.toLowerCase())
            }
            onChange={(value: string) => setPickedSession(value)}
          />
        )}
      </Modal>
    </div>
  )
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
