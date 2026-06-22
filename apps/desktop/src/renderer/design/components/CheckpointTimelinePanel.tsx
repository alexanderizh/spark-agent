/**
 * CheckpointTimelinePanel — 会话还原点（代码检查点）时间线抽屉
 *
 * 把「按会话撤回代码」这一已有能力（Claude SDK 文件检查点）做成集中、可扫、
 * 可一键还原的右侧滑出视图：倒序列出本会话所有还原点，每条可展开受影响文件清单，
 * 点击「回到这一步」二次确认后把工作区文件还原到该检查点。
 *
 * 纯受控组件（open + onClose）；列表自取（session:list-checkpoints），
 * 还原通过 onRestore 回调复用 ChatView 的 executeCheckpointRestore。
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionCheckpoint, SessionId } from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import './CheckpointTimelinePanel.less'

export interface CheckpointTimelinePanelProps {
  sessionId: SessionId | null
  open: boolean
  onClose: () => void
  /** 还原到指定检查点（复用 ChatView 的 /checkpoint restore 调用） */
  onRestore: (checkpointId: string) => Promise<void>
}

function formatRelativeTime(iso: string | undefined): string {
  if (iso == null) return ''
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return ''
  const diffMs = Date.now() - ts
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString()
}

export function CheckpointTimelinePanel({
  sessionId,
  open,
  onClose,
  onRestore,
}: CheckpointTimelinePanelProps): React.ReactElement | null {
  const { toast } = useToast()
  const { invoke: listCheckpoints } = useIpcInvoke('session:list-checkpoints')

  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (sessionId == null) {
      setCheckpoints([])
      return
    }
    setLoading(true)
    listCheckpoints({ sessionId })
      .then((res) => setCheckpoints(res.checkpoints))
      .catch(() => setCheckpoints([]))
      .finally(() => setLoading(false))
  }, [sessionId, listCheckpoints])

  useEffect(() => {
    if (!open) return
    // 延迟到下一个 tick，避免在 effect 体内同步 setState
    const id = window.setTimeout(() => refresh(), 0)
    return () => window.clearTimeout(id)
  }, [open, refresh])

  const handleRestore = useCallback(
    async (checkpointId: string) => {
      if (sessionId == null || restoringId != null) return
      setRestoringId(checkpointId)
      try {
        await onRestore(checkpointId)
        toast.success('已还原到该检查点')
        setConfirmId(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '还原失败')
      } finally {
        setRestoringId(null)
      }
    },
    [sessionId, restoringId, onRestore, toast],
  )

  if (!open) return null

  // Portal 到 body，避免全屏 fixed 遮罩被 chat-layout 的 ResizeObserver 计入侧栏宽度导致窗口被撑满。
  return createPortal(
    <div className="checkpoint-timeline-backdrop" onClick={onClose}>
      <aside
        className="checkpoint-timeline"
        role="dialog"
        aria-label="代码还原点时间线"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="checkpoint-timeline-head">
          <span className="checkpoint-timeline-head-icon">
            <Icons.History size={15} />
          </span>
          <span className="checkpoint-timeline-title">代码还原点</span>
          <button
            type="button"
            className="checkpoint-timeline-refresh"
            onClick={refresh}
            title="刷新"
            aria-label="刷新"
          >
            <Icons.Refresh size={14} />
          </button>
          <button
            type="button"
            className="checkpoint-timeline-close"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
          >
            <Icons.X size={16} />
          </button>
        </header>

        <div className="checkpoint-timeline-body">
          {loading && (
            <div className="checkpoint-timeline-state">
              <Icons.Spinner size={14} /> 加载中…
            </div>
          )}

          {!loading && checkpoints.length === 0 && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>本会话还没有代码还原点</p>
              <span>当 Agent 修改文件后，会自动在这里生成可还原的检查点。</span>
            </div>
          )}

          {!loading &&
            checkpoints.map((cp, idx) => {
              const fileCount = cp.filePaths?.length ?? 0
              const isExpanded = expandedId === cp.checkpointId
              const isConfirming = confirmId === cp.checkpointId
              const isRestoring = restoringId === cp.checkpointId
              const seq = checkpoints.length - idx
              return (
                <div className="checkpoint-item" key={cp.checkpointId}>
                  <div className="checkpoint-item-rail">
                    <span className="checkpoint-item-dot" />
                    {idx < checkpoints.length - 1 && <span className="checkpoint-item-line" />}
                  </div>
                  <div className="checkpoint-item-main">
                    <div className="checkpoint-item-head">
                      <span className="checkpoint-item-seq">#{seq}</span>
                      <span className="checkpoint-item-label">{cp.label ?? '检查点'}</span>
                      <span className="checkpoint-item-time">{formatRelativeTime(cp.timestamp)}</span>
                    </div>
                    <div className="checkpoint-item-meta">
                      {fileCount > 0 ? (
                        <button
                          type="button"
                          className="checkpoint-item-files-toggle"
                          onClick={() => setExpandedId(isExpanded ? null : cp.checkpointId)}
                        >
                          {isExpanded ? (
                            <Icons.ChevronDown size={12} />
                          ) : (
                            <Icons.ChevronRight size={12} />
                          )}
                          {fileCount} 个文件
                        </button>
                      ) : (
                        <span className="checkpoint-item-files-none">SDK 检查点</span>
                      )}
                      <span className="checkpoint-item-actions">
                        {isConfirming ? (
                          <>
                            <span className="checkpoint-item-confirm-text">将覆盖当前改动？</span>
                            <button
                              type="button"
                              className="btn ghost sm"
                              onClick={() => setConfirmId(null)}
                              disabled={isRestoring}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              className="btn sm danger-btn"
                              onClick={() => void handleRestore(cp.checkpointId)}
                              disabled={isRestoring}
                            >
                              {isRestoring ? <Icons.Spinner size={12} /> : '确认还原'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="checkpoint-item-restore"
                            onClick={() => setConfirmId(cp.checkpointId)}
                            disabled={restoringId != null}
                            title="把工作区文件还原到该检查点"
                          >
                            <Icons.RotateCcw size={12} /> 回到这一步
                          </button>
                        )}
                      </span>
                    </div>
                    {isExpanded && fileCount > 0 && (
                      <ul className="checkpoint-item-filelist">
                        {cp.filePaths?.map((fp) => (
                          <li key={fp} title={fp}>
                            <Icons.File size={11} />
                            <span className="checkpoint-item-filepath">{fp}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}
        </div>

        <footer className="checkpoint-timeline-foot">
          <Icons.AlertTriangle size={12} />
          <span>还原为文件级覆盖，仅作用于检查点记录的文件，不影响 Git 历史。</span>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}
