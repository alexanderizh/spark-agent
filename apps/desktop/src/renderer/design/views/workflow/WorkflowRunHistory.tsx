import { useCallback, useEffect, useState } from 'react'
import type { WorkflowRunDetail, WorkflowRunSummaryItem } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { formatRunClock, formatRunDuration, RunNodeRow, RUN_STATUS_META } from './WorkflowRunShared'

/**
 * 工作流「运行历史」面板：按 workflowId 列出历史运行（workflow_runs 持久化快照），
 * 点击展开单次运行的逐节点明细（状态/错误/输出预览/耗时）——数据经
 * buildWorkflowProgressNodes 还原，与实时 workflow_progress 渲染一致。
 */
export function WorkflowRunHistory({
  workflowId,
  onClose,
}: {
  workflowId: string
  onClose: () => void
}) {
  const { invoke: listRuns } = useIpcInvoke('workflow:runs')
  const { invoke: getRunDetail } = useIpcInvoke('workflow:run-detail')
  const [runs, setRuns] = useState<WorkflowRunSummaryItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkflowRunDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRuns(null)
    setLoadError(null)
    setOpenRunId(null)
    setDetail(null)
    listRuns({ workflowId })
      .then((response) => {
        if (!cancelled) setRuns(response.runs)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [listRuns, workflowId])

  const toggleRun = useCallback(
    (runId: string) => {
      if (openRunId === runId) {
        setOpenRunId(null)
        setDetail(null)
        setDetailError(null)
        return
      }
      setOpenRunId(runId)
      setDetail(null)
      setDetailError(null)
      getRunDetail({ runId })
        .then((response) => {
          if (response.run == null) {
            setDetailError('运行记录不存在或已被清理')
            return
          }
          setDetail(response.run)
        })
        .catch((error: unknown) => {
          setDetailError(error instanceof Error ? error.message : String(error))
        })
    },
    [getRunDetail, openRunId],
  )

  return (
    <div className="wf-run-history" role="complementary" aria-label="运行历史">
      <div className="wf-run-history-head">
        <span className="wf-run-history-title">运行历史</span>
        {runs != null && <span className="wf-run-history-count">{runs.length} 次</span>}
        <button
          type="button"
          className="wf-run-history-close"
          title="关闭"
          aria-label="关闭运行历史"
          onClick={onClose}
        >
          <Icons.X size={13} />
        </button>
      </div>
      <div className="wf-run-history-body">
        {loadError != null && <div className="wf-run-history-empty">加载失败：{loadError}</div>}
        {loadError == null && runs == null && (
          <div className="wf-run-history-empty">正在加载运行记录…</div>
        )}
        {loadError == null && runs != null && runs.length === 0 && (
          <div className="wf-run-history-empty">
            还没有运行记录。在会话里通过 workflow_run 运行后会在这里留下完整历史。
          </div>
        )}
        {runs != null &&
          runs.map((run) => {
            const statusMeta = RUN_STATUS_META[run.status]
            const durationMs =
              run.endedAt != null ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : Number.NaN
            const duration = formatRunDuration(durationMs)
            const open = openRunId === run.id
            return (
              <div key={run.id} className={`wf-run-item ${statusMeta.className}`}>
                <div
                  className="wf-run-item-head"
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggleRun(run.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleRun(run.id)
                    }
                  }}
                >
                  <span
                    className={`wf-run-status-dot ${statusMeta.className}`}
                    aria-hidden="true"
                  />
                  <span className="wf-run-item-main">
                    <span className="wf-run-item-objective" title={run.objective}>
                      {run.objective.length > 0 ? run.objective : '（无目标描述）'}
                    </span>
                    <span className="wf-run-item-meta">
                      <span className={`wf-run-status-text ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                      <span>{formatRunClock(run.startedAt)}</span>
                      {duration.length > 0 && <span>{duration}</span>}
                      <span>{run.completedCount} 节点完成</span>
                      {run.skippedCount > 0 && <span>{run.skippedCount} 跳过</span>}
                    </span>
                  </span>
                  <Icons.ChevronRight
                    size={12}
                    className={`wf-run-chevron ${open ? 'is-open' : ''}`}
                  />
                </div>
                {open && (
                  <div className="wf-run-item-detail">
                    {detailError != null && (
                      <div className="wf-run-history-empty">{detailError}</div>
                    )}
                    {detailError == null && detail == null && (
                      <div className="wf-run-history-empty">正在还原节点明细…</div>
                    )}
                    {detail != null && (
                      <div className="wf-run-node-list">
                        {detail.nodes.map((node) => (
                          <RunNodeRow key={node.nodeId} node={node} />
                        ))}
                        {detail.nodes.length === 0 && (
                          <div className="wf-run-history-empty">该运行没有可还原的节点记录。</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
