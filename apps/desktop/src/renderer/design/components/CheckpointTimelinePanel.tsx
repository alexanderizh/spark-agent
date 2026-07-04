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
import { Switch } from 'antd'
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
  /** 开关状态变化时通知父级（用于入口按钮样式同步） */
  onEnabledChange?: (enabled: boolean) => void
}

function formatCheckpointDisplayId(checkpointId: string): string {
  return checkpointId.length > 10 ? checkpointId.slice(-8) : checkpointId
}

function isRestoreBackupCheckpoint(checkpoint: SessionCheckpoint): boolean {
  return checkpoint.label === '还原前自动备份'
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
  onEnabledChange,
}: CheckpointTimelinePanelProps): React.ReactElement | null {
  const { toast } = useToast()
  const { invoke: listCheckpoints } = useIpcInvoke('session:list-checkpoints')
  const { invoke: getCheckpointConfig } = useIpcInvoke('session:get-checkpoint-config')
  const { invoke: setCheckpointConfig } = useIpcInvoke('session:set-checkpoint-config')

  const [enabled, setEnabled] = useState(false)
  const [available, setAvailable] = useState(true)
  const [toggling, setToggling] = useState(false)
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
    getCheckpointConfig({ sessionId })
      .then((res) => { setEnabled(res.enabled); setAvailable(res.available); onEnabledChange?.(res.enabled) })
      .catch(() => { setEnabled(false); setAvailable(false); onEnabledChange?.(false) })
    listCheckpoints({ sessionId })
      .then((res) => setCheckpoints(res.checkpoints))
      .catch(() => setCheckpoints([]))
      .finally(() => setLoading(false))
  }, [sessionId, listCheckpoints, getCheckpointConfig, onEnabledChange])

  const handleToggle = useCallback(async () => {
    if (sessionId == null || toggling) return
    setToggling(true)
    try {
      const res = await setCheckpointConfig({ sessionId, enabled: !enabled })
      setEnabled(res.enabled)
      onEnabledChange?.(res.enabled)
      toast.success(res.enabled ? '已开启代码还原点' : '已关闭代码还原点')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '切换失败')
    } finally {
      setToggling(false)
    }
  }, [sessionId, toggling, enabled, setCheckpointConfig, toast])

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
        refresh()
        toast.success('已还原到该检查点')
        setConfirmId(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '还原失败')
      } finally {
        setRestoringId(null)
      }
    },
    [sessionId, restoringId, onRestore, refresh, toast],
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
          <span
            className="checkpoint-timeline-toggle"
            title={!available ? '当前工作区不是 git 仓库，代码还原点不可用' : enabled ? '已开启：会在每轮开始前按需记录当前已跟踪文件状态。点击关闭' : '未开启：开启后会在每轮开始前按需记录当前已跟踪文件状态'}
          >
            <span className="checkpoint-timeline-toggle-label">{!available ? '不可用' : enabled ? '已开启' : '已关闭'}</span>
            <Switch
              size="middle"
              checked={enabled}
              loading={toggling}
              disabled={sessionId == null || !available}
              onChange={handleToggle}
              aria-label={enabled ? '关闭代码还原点' : '开启代码还原点'}
            />
          </span>
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

          {!loading && !available && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>代码还原点不可用</p>
              <span>该功能基于 git，仅在 git 仓库工作区可用。请在 git 项目中使用。</span>
            </div>
          )}

          {!loading && available && checkpoints.length === 0 && !enabled && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>代码还原点未开启</p>
              <span>开启后，Agent 开始新一轮前会按需记录当前已跟踪文件状态，之后可恢复到这个状态。</span>
            </div>
          )}

          {!loading && available && checkpoints.length === 0 && enabled && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>本会话还没有代码还原点</p>
              <span>当工作区相对上一个 checkpoint 出现新的已跟踪文件状态时，这里会新增记录。</span>
            </div>
          )}

          {!loading && available &&
            checkpoints.map((cp, idx) => {
              const fileCount = cp.filePaths?.length ?? 0
              const isExpanded = expandedId === cp.checkpointId
              const isConfirming = confirmId === cp.checkpointId
              const isRestoring = restoringId === cp.checkpointId
              const isRestoreBackup = isRestoreBackupCheckpoint(cp)
              const seq = checkpoints.length - idx
              const displayId = formatCheckpointDisplayId(cp.checkpointId)
              return (
                <div className="checkpoint-item" key={cp.checkpointId}>
                  <div className="checkpoint-item-rail">
                    <span className="checkpoint-item-dot" />
                    {idx < checkpoints.length - 1 && <span className="checkpoint-item-line" />}
                  </div>
                  <div className="checkpoint-item-main">
                    <div className="checkpoint-item-head">
                      <span className="checkpoint-item-seq">#{seq}</span>
                      <span className="checkpoint-item-label">Checkpoint</span>
                      <span className="checkpoint-item-id">#{displayId}</span>
                      {isRestoreBackup && <span className="checkpoint-item-id">自动备份</span>}
                      <span className="checkpoint-item-time">{formatRelativeTime(cp.timestamp)}</span>
                    </div>
                    <div className="checkpoint-item-meta">
                      {fileCount > 0 ? (
                        <button
                          type="button"
                          className="checkpoint-item-files-toggle"
                          onClick={() => setExpandedId(isExpanded ? null : cp.checkpointId)}
                        >
                          {isExpanded ? '收起文件' : `查看 ${fileCount} 个文件`}
                        </button>
                      ) : (
                        <span className="checkpoint-item-files-none">无文件清单</span>
                      )}
                      <span className="checkpoint-item-actions">
                        {isConfirming ? (
                          <>
                            <span className="checkpoint-item-confirm-text">将用这个 checkpoint 覆盖当前已跟踪文件？</span>
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
                            title="应用此 checkpoint"
                          >
                            应用
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
