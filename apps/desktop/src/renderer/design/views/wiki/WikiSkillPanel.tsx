/**
 * WikiSkillPanel — 技能提议区（S3：知识 → 技能的人工晋级闸门）。
 *
 * 设计纪律（对齐 WikiCandidatePanel）：
 *   - **扁平分组**：行间 1px 分割线，不用盒子卡片（仓库 UI 约定）；
 *   - **渐进披露**：默认只显示名称 + PURPOSE 摘要 + 溯源页数，展开才读
 *     SKILL.md 草稿全文与溯源页标题；
 *   - **模型自称接受无效**：只发结构化 IPC（wiki:skill:accept / reject）；
 *   - **拒绝原因必填**：这是留给下一轮提议的唯一反馈信号，空原因不让提交；
 *   - **接受即落地**：落盘 SKILL.md + PURPOSE.md 并登记 skills 表，成功后
 *     告知技能目录位置（用户可能想去看看 / 编辑）。
 */

import { useCallback, useEffect, useState } from 'react'
import { Modal, Spin } from 'antd'
import type { WikiSkillProposalItem } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { MarkdownText } from '../chat/ChatMarkdown'

/** 拒绝原因上限（与 protocol 的 zod 约束一致，前端先拦一层） */
const REASON_MAX = 500

export interface WikiSkillPanelProps {
  /** 决策后回调（刷新 Badge / 可能的知识页列表） */
  onDecided: () => void
}

export function WikiSkillPanel({ onDecided }: WikiSkillPanelProps) {
  const { toast } = useToast()
  const { invoke: listProposals } = useIpcInvoke('wiki:skill:list')
  const { invoke: acceptProposal } = useIpcInvoke('wiki:skill:accept')
  const { invoke: rejectProposal } = useIpcInvoke('wiki:skill:reject')

  const [items, setItems] = useState<WikiSkillProposalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  /** 待拒绝的提议（弹窗收集原因；原因必填） */
  const [rejecting, setRejecting] = useState<WikiSkillProposalItem | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listProposals({ status: 'pending' })
      setItems(res.items)
    } catch (err) {
      toast.error(`提议区加载失败：${errorText(err)}`)
    } finally {
      setLoading(false)
    }
  }, [listProposals, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 已接受的技能（本轮会话内接受成功的，用于展示落点） */
  const [acceptedPaths, setAcceptedPaths] = useState<Record<string, string>>({})

  const handleAccept = useCallback(
    async (item: WikiSkillProposalItem) => {
      setBusyId(item.id)
      try {
        const res = await acceptProposal({ id: item.id })
        if (!res.ok) throw new Error(res.message)
        toast.success(`技能已创建：${res.name}`)
        setAcceptedPaths((prev) => ({ ...prev, [item.id]: res.rootPath }))
        onDecided()
        await refresh()
      } catch (err) {
        toast.error(`创建失败：${errorText(err)}`)
        // 失败后提议可能已回滚为 pending：重取一次，避免界面停留在假象上
        await refresh()
      } finally {
        setBusyId(null)
      }
    },
    [acceptProposal, onDecided, refresh, toast],
  )

  const openReject = useCallback((item: WikiSkillProposalItem) => {
    setRejecting(item)
    setRejectReason('')
  }, [])

  const confirmReject = useCallback(async () => {
    if (rejecting == null) return
    const reason = rejectReason.trim()
    if (reason.length === 0) {
      toast.error('请填写拒绝原因（这会成为下一轮提议的参考）')
      return
    }
    setBusyId(rejecting.id)
    try {
      await rejectProposal({ id: rejecting.id, reason })
      toast.success('已拒绝，源知识页不受影响')
      setRejecting(null)
      onDecided()
      await refresh()
    } catch (err) {
      toast.error(`拒绝失败：${errorText(err)}`)
    } finally {
      setBusyId(null)
    }
  }, [onDecided, rejectProposal, rejecting, rejectReason, refresh, toast])

  return (
    <div className="wiki_body">
      <div className="wiki_results_head">
        技能提议区 · <b>{items.length}</b> 条待确认
        <span className="wiki_rail_spacer" />
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
          <div className="wiki_empty_title">没有待确认的技能提议</div>
          <div className="wiki_empty_desc">
            当会话里的 Agent 认为某几页知识已经成熟到可以固化成技能时，会把草案提到这里。
            你确认后才会生成 SKILL.md 与 PURPOSE.md，并登记为可用技能。
          </div>
        </div>
      ) : (
        <div className="wiki_cand_list">
          {items.map((item) => {
            const expanded = expandedId === item.id
            const busy = busyId === item.id
            const acceptedPath = acceptedPaths[item.id]
            return (
              <div key={item.id} className="wiki_cand_row">
                <div className="wiki_cand_head">
                  <Icons.Skills size={14} className="wiki_skill_icon" />
                  <span className="wiki_cand_title">{item.name}</span>
                  <span className="wiki_cand_kind">技能提议</span>
                </div>
                {item.description.length > 0 && (
                  <div className="wiki_cand_summary">{item.description}</div>
                )}
                <div className="wiki_cand_meta">
                  <span>溯源 {item.sourcePageIds.length} 页</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>

                {acceptedPath != null && (
                  <div className="wiki_skill_created">
                    已创建，目录：<code>{acceptedPath}</code>
                  </div>
                )}

                {expanded && (
                  <div className="wiki_cand_detail">
                    <div className="wiki_cand_detail_label">PURPOSE（为何创建）</div>
                    <div className="wiki_skill_purpose">{item.purpose}</div>
                    <div className="wiki_cand_detail_label">SKILL.md 草稿</div>
                    <div className="wiki_cand_preview">
                      <MarkdownText content={item.skillMd} />
                    </div>
                    <div className="wiki_cand_detail_label">溯源知识页</div>
                    <ul className="wiki_cand_sources">
                      {item.sourcePages.map((page) => (
                        <li key={page.id}>
                          <span className="wiki_skill_src_id">{page.id}</span>
                          {page.title}
                          {page.title === '（页面已删除）' && (
                            <span className="wiki_cand_lowconf"> 已删除</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    {item.triggers.length > 0 && (
                      <div className="wiki_skill_triggers">
                        触发场景：{item.triggers.join('、')}
                      </div>
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
                    {expanded ? '收起' : '查看草稿与溯源'}
                  </button>
                  <span className="wiki_rail_spacer" />
                  <button
                    type="button"
                    className="wiki_btn_ghost"
                    style={{ height: 26 }}
                    disabled={busy}
                    onClick={() => openReject(item)}
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    className="wiki_btn_primary"
                    style={{ height: 26 }}
                    disabled={busy}
                    onClick={() => void handleAccept(item)}
                  >
                    接受并创建技能
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        title={`拒绝技能提议：${rejecting?.name ?? ''}`}
        open={rejecting != null}
        onCancel={() => setRejecting(null)}
        onOk={() => void confirmReject()}
        okText="确认拒绝"
        cancelText="取消"
        confirmLoading={busyId != null}
        okButtonProps={{ disabled: rejectReason.trim().length === 0 }}
      >
        <div className="wiki_skill_reject_tip">
          拒绝只会记录原因，<b>不会删除任何知识页</b>
          。下一轮若再提议同名技能，Agent 会看到这次的原因并调整草案。
        </div>
        <textarea
          className="wiki_skill_reason"
          value={rejectReason}
          maxLength={REASON_MAX}
          placeholder={`例如：与既有的 commit 技能能力重叠 / 范围太大，先拆成两步 / 触发场景描述不清`}
          onChange={(event) => setRejectReason(event.target.value)}
        />
        <div className="wiki_skill_reason_count">
          {rejectReason.length}/{REASON_MAX}
        </div>
      </Modal>
    </div>
  )
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
