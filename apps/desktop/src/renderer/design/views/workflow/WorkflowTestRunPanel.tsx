/**
 * @module WorkflowTestRunPanel
 *
 * 工作流「编辑器内试跑」面板。
 *
 * 触发链路：workflow:test-run（主进程复用/新建绑定 agent → 建试跑会话 → 提交
 * objective turn，真实运行时与会话留档）。启动后按返回的 sessionId 轮询
 * workflow:runs 关联 run，再轮询 workflow:run-detail 展示节点级进度——与运行
 * 历史面板复用同一套明细渲染（WorkflowRunShared）。
 */

import { useCallback, useEffect, useState } from 'react'
import type { WorkflowRunDetail } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { formatRunDuration, RunNodeRow, RUN_STATUS_META } from './WorkflowRunShared'

/** 轮询间隔：进度不需要亚秒级实时，1.5s 足够顺滑且不冲击 DB。 */
const POLL_INTERVAL_MS = 1500

type TestRunPhase =
  | { kind: 'idle' }
  | { kind: 'launching' }
  | { kind: 'running'; sessionId: string; run: WorkflowRunDetail | null }
  | { kind: 'terminal'; sessionId: string; run: WorkflowRunDetail | null }
  | { kind: 'error'; message: string }

export function WorkflowTestRunPanel({
  workflowId,
  workflowDescription,
  onClose,
  onOpenSession,
}: {
  workflowId: string
  workflowDescription: string
  onClose: () => void
  /** 跳转到会话视图（由 WorkflowView 接线 setTweak + setActiveSession）。 */
  onOpenSession: (sessionId: string) => void
}) {
  const { invoke: startTestRun } = useIpcInvoke('workflow:test-run')
  const { invoke: listRuns } = useIpcInvoke('workflow:runs')
  const { invoke: getRunDetail } = useIpcInvoke('workflow:run-detail')

  const [objective, setObjective] = useState('')
  const [phase, setPhase] = useState<TestRunPhase>({ kind: 'idle' })

  const launch = useCallback(() => {
    setPhase({ kind: 'launching' })
    const trimmed = objective.trim()
    startTestRun({ workflowId, ...(trimmed.length > 0 ? { objective: trimmed } : {}) })
      .then((response) => {
        // 直接锁定本次试跑会话：run 记录由 turn 内 workflow_run 异步创建，
        // 轮询按 sessionId 精确关联，不会跟错同工作流的并发运行。
        setPhase({ kind: 'running', sessionId: response.sessionId, run: null })
      })
      .catch((error: unknown) => {
        setPhase({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
  }, [objective, startTestRun, workflowId])

  // ── 轮询链：runs（按 sessionId 找本次 run）→ run-detail（节点级进度）→ 终态停止 ──
  // 依赖数组里的 sessionId 在组件体先收窄（联合类型在 deps 数组无法收窄）。
  const pollSessionId = phase.kind === 'running' ? phase.sessionId : null
  useEffect(() => {
    if (pollSessionId == null) return
    const sessionId = pollSessionId
    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const response = await listRuns({ workflowId, limit: 30 })
        if (cancelled) return
        const mine = response.runs.find((run) => run.sessionId === sessionId)
        if (mine == null) return // run 尚未由 workflow_run 创建，下个 tick 再看
        const detailResponse = await getRunDetail({ runId: mine.id })
        if (cancelled) return
        if (detailResponse.run == null) return
        if (detailResponse.run.status === 'working') {
          setPhase({ kind: 'running', sessionId, run: detailResponse.run })
        } else {
          setPhase({ kind: 'terminal', sessionId, run: detailResponse.run })
        }
      } catch {
        // 单次轮询失败（如 DB 短暂忙）静默跳过，下个 tick 重试。
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [pollSessionId, getRunDetail, listRuns, workflowId])

  const run = phase.kind === 'running' || phase.kind === 'terminal' ? phase.run : null
  const sessionId = phase.kind === 'running' || phase.kind === 'terminal' ? phase.sessionId : ''
  const busy = phase.kind === 'launching' || phase.kind === 'running'

  return (
    <div className="wf-run-history wf-test-run" role="complementary" aria-label="试跑">
      <div className="wf-run-history-head">
        <span className="wf-run-history-title">试跑</span>
        <button
          type="button"
          className="wf-run-history-close"
          title="关闭"
          aria-label="关闭试跑面板"
          onClick={onClose}
        >
          <Icons.X size={13} />
        </button>
      </div>
      <div className="wf-run-history-body">
        <div className="wf-test-run-form">
          <textarea
            className="wf-test-run-objective"
            placeholder={
              workflowDescription.trim().length > 0
                ? `试跑目标（留空使用工作流描述）：${workflowDescription.slice(0, 60)}`
                : '试跑目标（留空自动生成）'
            }
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            disabled={busy}
            rows={2}
          />
          <div className="wf-test-run-form-foot">
            {phase.kind === 'error' && <div className="wf-test-run-error">{phase.message}</div>}
            <button type="button" className="wf-test-run-start" disabled={busy} onClick={launch}>
              {busy ? (
                <>
                  <span className="wf-run-node-dot" aria-hidden="true" />
                  {phase.kind === 'launching' ? '正在启动…' : '运行中…'}
                </>
              ) : (
                <>
                  <Icons.Play size={12} />
                  {phase.kind === 'terminal' ? '再跑一次' : '开始试跑'}
                </>
              )}
            </button>
          </div>
          <div className="wf-test-run-note">
            试跑会创建一个真实会话并完整执行工作流（含审批/重试），运行记录可在会话与运行历史中追溯。
          </div>
        </div>

        {run != null && (
          <div className={`wf-test-run-live ${RUN_STATUS_META[run.status].className}`}>
            <div className="wf-test-run-live-head">
              <span
                className={`wf-run-status-dot ${RUN_STATUS_META[run.status].className}`}
                aria-hidden="true"
              />
              <span className={`wf-run-status-text ${RUN_STATUS_META[run.status].className}`}>
                {RUN_STATUS_META[run.status].label}
              </span>
              {run.endedAt != null && (
                <span className="wf-test-run-live-duration">
                  {formatRunDuration(Date.parse(run.endedAt) - Date.parse(run.startedAt))}
                </span>
              )}
              {sessionId.length > 0 && (
                <button
                  type="button"
                  className="wf-test-run-open-session"
                  onClick={() => onOpenSession(sessionId)}
                >
                  打开会话
                </button>
              )}
            </div>
            <div className="wf-run-node-list">
              {run.nodes.map((node) => (
                <RunNodeRow key={node.nodeId} node={node} />
              ))}
              {run.nodes.length === 0 && (
                <div className="wf-run-history-empty">
                  {phase.kind === 'running' ? '正在等待第一个节点启动…' : '没有可展示的节点记录。'}
                </div>
              )}
            </div>
          </div>
        )}
        {phase.kind === 'running' && run == null && (
          <div className="wf-run-history-empty">
            试跑会话已创建，正在等待工作流启动，随后这里会展示节点级进度…
          </div>
        )}
      </div>
    </div>
  )
}
