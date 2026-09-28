/**
 * RecoveryCenterView — 任务执行时间线 / 恢复中心（执行连续性 Phase 1 UI）
 *
 * 展示（方案 §13）：
 *  - 启动扫描摘要：自动恢复 / 需要确认 / 无法恢复，明确区分而非统一显示失败
 *  - 活跃 Run 列表（flat 分组：需要处理 / 恢复中 / 已暂停），状态点 + 分割线层级
 *  - Run 详情：恢复等级与降级原因、步骤统计、副作用信封、等待、恢复点
 *  - needs_attention 动作：安全继续 / 确认未知副作用 / 从恢复点重启 / 放弃但保留现场
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import type {
  ExecutionGetRunDetailResponse,
  ExecutionListRunsResponse,
  ExecutionResolveRunResponse,
  ExecutionRunSummary,
} from '@spark/protocol'
import './RecoveryCenterView.less'

type RunDetail = NonNullable<ExecutionGetRunDetailResponse['detail']>

type ResolveActionId =
  | 'safe_continue'
  | 'confirm_unknown_effects'
  | 'restart_from_checkpoint'
  | 'abandon_keep_state'

const STATUS_LABELS: Record<string, string> = {
  accepted: '已接受',
  running: '执行中',
  pausing: '暂停中',
  paused: '已暂停',
  waiting: '等待中',
  orphaned: '已失联',
  recovering: '恢复中',
  needs_attention: '需要处理',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
}

const KIND_LABELS: Record<string, string> = {
  turn: '会话任务',
  goal: '目标',
  workflow: '工作流',
  subagent: '子 Agent',
  scheduled: '定时任务',
  subapp: '子应用',
  media: '媒体任务',
}

const EFFECT_PHASE_LABELS: Record<string, string> = {
  prepared: '已登记未派发',
  dispatching: '派发中',
  confirmed: '已确认',
  failed: '已失败',
  unknown: '结果未知',
  compensated: '已补偿',
}

const DEGRADATION_LABELS: Record<string, string> = {
  no_side_effect_proof: '无法证明未派发副作用',
  effects_unknown: '存在结果未知的副作用',
  checkpoint_missing: '无可用恢复点',
  checkpoint_checksum_mismatch: '恢复点校验失败',
  checkpoint_schema_mismatch: '恢复点版本不兼容',
  provider_profile_changed: '供应商已变更',
  model_changed: '模型已变更',
  definition_changed: '任务定义已变更',
}

/** 中断原因的中文映射（Phase 3B/3C 新增的语义化 reason）。 */
const INTERRUPTION_REASON_LABELS: Record<string, string> = {
  workflow_deferred_resume: '应用重启中断；将在您下次于所属会话发送消息时自动继续（使用冻结的图版本）',
  goal_startup_recovery: '应用重启中断；等待目标恢复处理',
  goal_iteration_interrupted: '目标的一轮迭代被应用重启中断，请先处理该迭代任务',
  subapp_job_interrupted: '子应用任务被应用重启中断（不做自动恢复，现场已保留）',
  subapp_job_stale_running: '子应用任务状态异常（仍标记执行中）',
  app_shutdown: '应用退出时安全暂停',
}

function degradationText(reason: string): string {
  if (DEGRADATION_LABELS[reason] != null) return DEGRADATION_LABELS[reason]
  if (reason.startsWith('unverifiable_tools:')) {
    return `不可验证的工具：${reason.slice('unverifiable_tools:'.length)}`
  }
  return reason
}

function formatTime(iso: string | null): string {
  if (iso == null) return '—'
  try {
    const date = new Date(iso)
    const now = Date.now()
    const diffMin = Math.floor((now - date.getTime()) / 60_000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} 小时前`
    return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

export function RecoveryCenterView() {
  const [runs, setRuns] = useState<ExecutionRunSummary[]>([])
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = (await window.spark.invoke('execution:list-runs', {
        activeOnly: true,
      })) as ExecutionListRunsResponse
      setRuns(res.runs ?? [])
      const summaryRes = (await window.spark.invoke('execution:get-startup-summary', {})) as {
        summary: ExecutionListRunsResponse & {
          autoResumed?: number
          needsAttention?: number
          cannotRecover?: number
        } | null
      }
      const summary = summaryRes?.summary as unknown as {
        autoResumed: number
        needsAttention: number
        cannotRecover: number
      } | null
      if (summary != null && summary.autoResumed + summary.needsAttention + summary.cannotRecover > 0) {
        const parts: string[] = []
        if (summary.autoResumed > 0) parts.push(`已自动恢复 ${summary.autoResumed} 个任务`)
        if (summary.needsAttention > 0) parts.push(`${summary.needsAttention} 个任务需要确认`)
        if (summary.cannotRecover > 0) parts.push(`${summary.cannotRecover} 个任务无法恢复`)
        setSummaryText(parts.join(' · '))
      } else {
        setSummaryText(null)
      }
    } catch (error) {
      setActionMessage(`加载失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 10_000)
    const off = window.spark?.on?.('stream:execution:runs-changed', () => {
      void refresh()
    })
    return () => {
      clearInterval(timer)
      off?.()
    }
  }, [refresh])

  const loadDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    try {
      const res = (await window.spark.invoke('execution:get-run-detail', {
        runId,
      })) as ExecutionGetRunDetailResponse
      setDetail(res.detail)
    } catch (error) {
      setActionMessage(`详情加载失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const toggleRun = useCallback(
    (runId: string) => {
      if (expandedRunId === runId) {
        setExpandedRunId(null)
        setDetail(null)
        return
      }
      setExpandedRunId(runId)
      void loadDetail(runId)
    },
    [expandedRunId, loadDetail],
  )

  const resolveAction = useCallback(
    async (runId: string, action: ResolveActionId) => {
      // 请求往返期间禁用所有动作按钮，防双击重复入队恢复 Turn。
      if (actionPending != null) return
      setActionPending(`${runId}:${action}`)
      try {
        const res = (await window.spark.invoke('execution:resolve-run', {
          runId,
          action,
        })) as ExecutionResolveRunResponse
        setActionMessage(res.message)
        if (res.ok) {
          await refresh()
          if (expandedRunId === runId) await loadDetail(runId)
        }
      } catch (error) {
        setActionMessage(`操作失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setActionPending(null)
      }
    },
    [actionPending, expandedRunId, loadDetail, refresh],
  )

  const grouped = useMemo(() => {
    const needsAttention = runs.filter((run) => run.status === 'needs_attention' || run.status === 'orphaned')
    const recovering = runs.filter(
      (run) => run.status === 'recovering' || run.status === 'running' || run.status === 'accepted',
    )
    const paused = runs.filter(
      (run) => run.status === 'paused' || run.status === 'pausing' || run.status === 'waiting',
    )
    return { needsAttention, recovering, paused }
  }, [runs])

  const renderRunRow = (run: ExecutionRunSummary) => {
    const isExpanded = expandedRunId === run.id
    return (
      <div key={run.id} className="rc-run">
        <button
          className={`rc-run-row${isExpanded ? ' rc-run-row-expanded' : ''}`}
          onClick={() => toggleRun(run.id)}
        >
          <span className={`rc-status-dot rc-status-${run.status}`} />
          <span className="rc-run-kind">{KIND_LABELS[run.kind] ?? run.kind}</span>
          <span className="rc-run-title">
            {run.rootTurnId != null ? `任务 ${run.rootTurnId.slice(0, 8)}` : `运行 ${run.id.slice(0, 14)}`}
          </span>
          <span className={`rc-run-status rc-run-status-${run.status}`}>
            {STATUS_LABELS[run.status] ?? run.status}
          </span>
          <span className="rc-run-level" title="当前恢复保证等级">
            L{run.currentGuaranteedLevel}
          </span>
          {run.effectCounts.unknown > 0 && (
            <span className="rc-run-flag rc-run-flag-warn">{run.effectCounts.unknown} 个副作用未知</span>
          )}
          {run.openWaits > 0 && <span className="rc-run-flag">{run.openWaits} 个等待</span>}
          <span className="rc-run-time">{formatTime(run.updatedAt)}</span>
          <Icons.ChevronRight
            size={14}
            className={`rc-run-chevron${isExpanded ? ' rc-run-chevron-open' : ''}`}
          />
        </button>
        {isExpanded && (
          <div className="rc-run-detail">
            {detailLoading && <div className="rc-detail-loading">加载详情…</div>}
            {detail != null && detail.run.id === run.id && (
              <>
                <div className="rc-detail-section">
                  <div className="rc-detail-label">恢复等级</div>
                  <div className="rc-detail-body">
                    <span className="rc-level-badge">L{detail.run.currentGuaranteedLevel}</span>
                    <span className="rc-level-note">
                      上限 L{detail.run.capabilityCeiling}
                      {detail.latestPlan != null && detail.latestPlan.decision === 'needs_confirmation'
                        ? ' · 恢复需要确认'
                        : ''}
                    </span>
                  </div>
                  {detail.latestPlan != null && detail.latestPlan.degradationReasons.length > 0 && (
                    <ul className="rc-degradation-list">
                      {detail.latestPlan.degradationReasons.map((reason) => (
                        <li key={reason}>{degradationText(reason)}</li>
                      ))}
                    </ul>
                  )}
                  {detail.run.interruptionReason != null && (
                    <div className="rc-interruption">
                      中断原因：
                      {INTERRUPTION_REASON_LABELS[detail.run.interruptionReason] ??
                        detail.run.interruptionReason}
                    </div>
                  )}
                </div>
                <div className="rc-detail-section">
                  <div className="rc-detail-label">步骤</div>
                  <div className="rc-detail-body rc-detail-counts">
                    <span>已提交 {detail.run.stepCounts.committed}</span>
                    <span>执行中 {detail.run.stepCounts.running}</span>
                    <span>未知 {detail.run.stepCounts.uncertain}</span>
                    <span>等待 {detail.run.stepCounts.waiting}</span>
                    <span>计划中 {detail.run.stepCounts.planned}</span>
                  </div>
                </div>
                {detail.effects.length > 0 && (
                  <div className="rc-detail-section">
                    <div className="rc-detail-label">副作用信封</div>
                    <div className="rc-effects">
                      {detail.effects.slice(0, 12).map((effect) => (
                        <div key={effect.id} className="rc-effect-row">
                          <span className={`rc-effect-phase rc-effect-phase-${effect.phase}`}>
                            {EFFECT_PHASE_LABELS[effect.phase] ?? effect.phase}
                          </span>
                          <span className="rc-effect-tool">{effect.toolName}</span>
                          <span className="rc-effect-policy">
                            {effect.replayPolicy === 'query_then_resume'
                              ? '只查询不重发'
                              : effect.replayPolicy === 'safe'
                                ? '可安全重跑'
                                : '需确认'}
                          </span>
                        </div>
                      ))}
                      {detail.effects.length > 12 && (
                        <div className="rc-effect-more">…共 {detail.effects.length} 条</div>
                      )}
                    </div>
                  </div>
                )}
                {detail.checkpoints.length > 0 && detail.checkpoints[0] != null && (
                  <div className="rc-detail-section">
                    <div className="rc-detail-label">恢复点</div>
                    <div className="rc-detail-body rc-checkpoints">
                      最新 #{detail.checkpoints[0].sequence}（{formatTime(detail.checkpoints[0].createdAt)}）
                      · 共 {detail.checkpoints.length} 个
                    </div>
                  </div>
                )}
                {(run.status === 'needs_attention' || run.status === 'orphaned' || run.status === 'paused') && (
                  <div className="rc-actions">
                    <Button
                      size="small"
                      type="primary"
                      disabled={actionPending != null}
                      onClick={() => resolveAction(run.id, 'safe_continue')}
                    >
                      安全继续
                    </Button>
                    {run.effectCounts.unknown > 0 && (
                      <Button
                        size="small"
                        disabled={actionPending != null}
                        onClick={() => resolveAction(run.id, 'confirm_unknown_effects')}
                      >
                        确认未知副作用已发生
                      </Button>
                    )}
                    <Button
                      size="small"
                      disabled={actionPending != null}
                      onClick={() => resolveAction(run.id, 'restart_from_checkpoint')}
                    >
                      从恢复点重启
                    </Button>
                    <Button
                      size="small"
                      disabled={actionPending != null}
                      onClick={() => resolveAction(run.id, 'abandon_keep_state')}
                    >
                      放弃任务（保留现场）
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const empty = !loading && runs.length === 0

  return (
    <div className="recovery-center-view">
      <div className="rc-header">
        <div className="rc-header-left">
          <Icons.History size={18} />
          <h2 className="rc-title">恢复中心</h2>
          <span className="rc-subtitle">长程任务的断点继续与副作用调和</span>
        </div>
        <div className="rc-header-actions">
          <Button size="middle" type="text" icon={<Icons.RotateCcw size={13} />} onClick={() => void refresh()}>
            刷新
          </Button>
        </div>
      </div>

      {summaryText != null && (
        <div className="rc-startup-summary">
          <span className="rc-summary-dot" />
          本次启动：{summaryText}
        </div>
      )}
      {actionMessage != null && <div className="rc-action-message">{actionMessage}</div>}

      <div className="rc-body">
        {loading && <div className="rc-empty">加载中…</div>}
        {empty && (
          <div className="rc-empty">
            <Icons.CheckCircle size={28} />
            <div>没有需要恢复的任务</div>
            <div className="rc-empty-note">
              应用重启后，可安全恢复的任务会自动继续；需要确认的任务会出现在这里。
            </div>
          </div>
        )}
        {!loading && grouped.needsAttention.length > 0 && (
          <div className="rc-group">
            <div className="rc-group-header">
              <span className="rc-group-dot rc-group-dot-warn" />
              需要处理
              <span className="rc-group-count">{grouped.needsAttention.length}</span>
            </div>
            {grouped.needsAttention.map(renderRunRow)}
          </div>
        )}
        {!loading && grouped.recovering.length > 0 && (
          <div className="rc-group">
            <div className="rc-group-header">
              <span className="rc-group-dot rc-group-dot-run" />
              执行与恢复中
              <span className="rc-group-count">{grouped.recovering.length}</span>
            </div>
            {grouped.recovering.map(renderRunRow)}
          </div>
        )}
        {!loading && grouped.paused.length > 0 && (
          <div className="rc-group">
            <div className="rc-group-header">
              <span className="rc-group-dot rc-group-dot-pause" />
              已暂停（重启中断）
              <span className="rc-group-count">{grouped.paused.length}</span>
            </div>
            {grouped.paused.map(renderRunRow)}
          </div>
        )}
      </div>

      <div className="rc-footer">
        恢复只保证已保存的进度；结果未知的副作用在确认前不会自动重试。文件状态由「工作区快照」单独管理。
      </div>
    </div>
  )
}
