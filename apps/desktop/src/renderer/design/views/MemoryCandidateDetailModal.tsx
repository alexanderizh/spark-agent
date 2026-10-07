/**
 * MemoryCandidateDetailModal — 「待确认提议」候选详情弹层
 *
 * 点击候选行主体打开：完整正文（pre-wrap + 滚动）、摘要、置信度、来源、
 * 创建/过期时间（过期明确标注）。payload 为 null 的候选也可打开，仅展示
 * 元信息并提示内容不可解析。底部确认/忽略复用面板的现有回调，操作成功
 * 后由面板监听 MEMORY_PENDING_CHANGED_EVENT 关闭弹层。
 * 样式落 MemoryPanel.less（mp_candidate_detail_* 前缀），风格与面板一致。
 */
import { Button, Tag } from '@lobehub/ui'
import { Modal } from 'antd'
import type { MemoryCandidateListResponse } from '@spark/protocol'

/** 候选结构：直接从协议列表响应派生，避免与 MemoryPanel 内联类型两处维护 */
export type MemoryCandidate = NonNullable<
  MemoryCandidateListResponse['candidates']
>[number]

interface MemoryCandidateDetailModalProps {
  candidate: MemoryCandidate | null
  /** 该候选操作进行中（对应面板 candidateBusy === id），两键同态与列表行为一致 */
  busy: boolean
  onConfirm: (id: number, contentDigest: string) => void
  onReject: (id: number) => void
  onClose: () => void
}

export function MemoryCandidateDetailModal({
  candidate,
  busy,
  onConfirm,
  onReject,
  onClose,
}: MemoryCandidateDetailModalProps) {
  // 过期判定按毫秒时间戳与当前时间比较；仅做标注不禁用按钮（后端确认时兜底拒绝）。
  // 纯客户端弹层无 SSR 幂等约束，过期状态本就应随当前时间实时判定
  // eslint-disable-next-line react-hooks/purity -- expiry is intentionally evaluated against wall-clock at render time
  const expired = candidate != null && candidate.expiresAt < Date.now()
  return (
    <Modal
      open={candidate != null}
      onCancel={onClose}
      title={candidate?.payload?.name ?? '候选详情'}
      width="min(560px, 94vw)"
      footer={
        // null = 不渲染 footer；antd 语义里 undefined 会回落默认 [取 消][确 定] 按钮组，
        // 关闭动画期间（candidate 已置 null）会闪现这组多余按钮
        candidate == null ? null : (
          <>
            <Button loading={busy} onClick={() => onReject(candidate.id)}>
              忽略
            </Button>
            <Button
              type="primary"
              danger={candidate.payload?.action === 'delete'}
              disabled={candidate.payload == null}
              loading={busy}
              onClick={() => onConfirm(candidate.id, candidate.contentDigest)}
            >
              {candidate.payload?.action === 'update'
                ? '确认更新'
                : candidate.payload?.action === 'delete'
                  ? '确认删除'
                  : candidate.payload?.action === 'merge'
                    ? '确认合并'
                    : '确认保存'}
            </Button>
          </>
        )
      }
    >
      {candidate != null && (
        <div className="mp_candidate_detail_root">
          <div className="mp_candidate_detail_tags">
            <Tag size="middle">{candidate.scope}</Tag>
            {candidate.payload != null && <Tag size="middle">{candidate.payload.type}</Tag>}
            {/* 【P2-A】动作分化：冲突写入候选醒目标注将执行的动作 */}
            {candidate.payload?.action === 'update' && (
              <Tag size="middle" color="orange">
                更新提议
              </Tag>
            )}
            {candidate.payload?.action === 'delete' && (
              <Tag size="middle" color="red">
                删除提议
              </Tag>
            )}
            {candidate.payload?.action === 'merge' && (
              <Tag size="middle" color="purple">
                合并提议
              </Tag>
            )}
            {expired && (
              <Tag size="middle" color="red">
                已过期
              </Tag>
            )}
          </div>

          {candidate.payload == null ? (
            <div className="mp_candidate_detail_unparsed">
              内容不可解析：该候选正文无法解析为结构化记忆，不能确认保存，建议忽略。
            </div>
          ) : (
            <>
              <div className="mp_candidate_detail_label">完整内容</div>
              <div className="mp_candidate_detail_body">{candidate.payload.body}</div>
              <div className="mp_candidate_detail_label">摘要</div>
              <div className="mp_candidate_detail_text">{candidate.payload.description}</div>
            </>
          )}

          <div className="mp_candidate_detail_meta">
            {candidate.payload != null && (
              <span>置信度：{Math.round(candidate.payload.confidence * 100)}%</span>
            )}
            <span>创建时间：{new Date(candidate.createdAt).toLocaleString()}</span>
            <span>
              过期时间：{new Date(candidate.expiresAt).toLocaleString()}
              {expired ? '（已过期）' : ''}
            </span>
            {candidate.scopeRef != null && candidate.scopeRef !== '' && (
              <span>
                归属 {candidate.scope}：{candidate.scopeRef}
              </span>
            )}
            {candidate.payload != null && candidate.payload.sourceIds.length > 0 && (
              <span className="mp_candidate_detail_sources">
                依据 {candidate.payload.sourceIds.length} 条既有记忆：
                {candidate.payload.sourceIds.join('、')}
              </span>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
