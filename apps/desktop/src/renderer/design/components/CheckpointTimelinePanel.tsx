/**
 * CheckpointTimelinePanel — 工作区快照时间线抽屉
 *
 * 「工作区快照」只恢复文件状态，不代表任务断点（Phase 0 语义拆分，见
 * docs/spark-work开发相关/plans/2026-09-10-长程任务断点继续与执行连续性重构方案.md §12）：
 * - workspace_snapshot：宿主 Git 快照，可预览（dry-run 分组）后非破坏性还原；
 * - provider_sdk：引擎原生快照，仅作上下文锚点展示，不提供宿主还原；
 * - 后端验证失效的 ref 置灰展示，不再提供不可用按钮。
 *
 * 纯受控组件（open + onClose）；列表自取（session:list-checkpoints），
 * 还原前经 session:preview-checkpoint-restore 预览，确认后通过 onRestore
 * 回调复用 ChatView 的 executeCheckpointRestore。
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Switch } from 'antd'
import type {
  SessionCheckpoint,
  SessionId,
  SessionPreviewCheckpointRestoreResponse,
} from '@spark/protocol'
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

/** 快照种类：显式标记优先，旧数据按 sdkSessionId 推断（与后端读取侧一致）。 */
function checkpointKindOf(cp: SessionCheckpoint): 'workspace_snapshot' | 'provider_sdk' {
  if (cp.checkpointKind != null) return cp.checkpointKind
  return cp.sdkSessionId != null ? 'provider_sdk' : 'workspace_snapshot'
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

/** 预览分组展示上限：超出折叠为「等 N 个」，避免巨清单撑爆抽屉。 */
const PREVIEW_FILE_LIMIT = 30

function PreviewFileList({ title, files, tone }: { title: string; files: string[]; tone: string }) {
  const [expanded, setExpanded] = useState(false)
  if (files.length === 0) return null
  const shown = expanded ? files : files.slice(0, PREVIEW_FILE_LIMIT)
  return (
    <div className={`checkpoint-preview-group ${tone}`}>
      <button
        type="button"
        className="checkpoint-preview-group-title"
        onClick={() => setExpanded(!expanded)}
      >
        <span>{title}</span>
        <span className="checkpoint-preview-group-count">{files.length}</span>
      </button>
      {(expanded || files.length <= PREVIEW_FILE_LIMIT) && (
        <ul className="checkpoint-preview-files">
          {shown.map((fp) => (
            <li key={fp} title={fp}>
              {fp}
            </li>
          ))}
        </ul>
      )}
      {files.length > PREVIEW_FILE_LIMIT && !expanded && (
        <button
          type="button"
          className="checkpoint-preview-more"
          onClick={() => setExpanded(true)}
        >
          展开全部 {files.length} 个
        </button>
      )}
    </div>
  )
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
  const { invoke: previewRestore } = useIpcInvoke('session:preview-checkpoint-restore')
  const { invoke: getCheckpointFiles } = useIpcInvoke('session:get-checkpoint-files')

  const [enabled, setEnabled] = useState(false)
  const [available, setAvailable] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [checkpoints, setCheckpoints] = useState<SessionCheckpoint[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [fileCache, setFileCache] = useState<Record<string, string[]>>({})
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<SessionPreviewCheckpointRestoreResponse | null>(
    null,
  )
  const [previewLoading, setPreviewLoading] = useState(false)
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
      toast.success(res.enabled ? '已开启工作区快照' : '已关闭工作区快照')
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

  const toggleFileList = useCallback(
    async (cp: SessionCheckpoint) => {
      const id = cp.checkpointId
      if (expandedId === id) {
        setExpandedId(null)
        return
      }
      setExpandedId(id)
      if (fileCache[id] != null) return
      try {
        const res = await getCheckpointFiles({ sessionId: sessionId as SessionId, checkpointId: id })
        setFileCache((prev) => ({ ...prev, [id]: res.filePaths }))
      } catch {
        setFileCache((prev) => ({ ...prev, [id]: [] }))
      }
    },
    [expandedId, fileCache, getCheckpointFiles, sessionId],
  )

  /** 点击「预览还原」：dry-run 分组预览，确认后才真正还原。 */
  const handleStartPreview = useCallback(
    async (checkpointId: string) => {
      if (sessionId == null || previewLoading || restoringId != null) return
      setPreviewId(checkpointId)
      setPreviewData(null)
      setPreviewLoading(true)
      try {
        const res = await previewRestore({ sessionId, checkpointId })
        setPreviewData(res)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '生成还原预览失败')
        setPreviewId(null)
      } finally {
        setPreviewLoading(false)
      }
    },
    [sessionId, previewLoading, restoringId, previewRestore, toast],
  )

  const handleRestore = useCallback(
    async (checkpointId: string) => {
      if (sessionId == null || restoringId != null) return
      setRestoringId(checkpointId)
      try {
        await onRestore(checkpointId)
        refresh()
        toast.success('已还原该工作区快照')
        setPreviewId(null)
        setPreviewData(null)
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
        aria-label="工作区快照时间线"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="checkpoint-timeline-head">
          <span className="checkpoint-timeline-head-icon">
            <Icons.History size={15} />
          </span>
          <span className="checkpoint-timeline-title">工作区快照</span>
          <span
            className="checkpoint-timeline-toggle"
            title={!available ? '当前工作区不是 git 仓库，工作区快照不可用' : enabled ? '已开启：会在每轮改动文件前记录工作区文件状态。点击关闭' : '未开启：开启后会在每轮改动文件前记录工作区文件状态'}
          >
            <span className="checkpoint-timeline-toggle-label">{!available ? '不可用' : enabled ? '已开启' : '已关闭'}</span>
            <Switch
              size="middle"
              checked={enabled}
              loading={toggling}
              disabled={sessionId == null || !available}
              onChange={handleToggle}
              aria-label={enabled ? '关闭工作区快照' : '开启工作区快照'}
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
              <p>工作区快照不可用</p>
              <span>该功能基于 git，仅在 git 仓库工作区可用。请在 git 项目中使用。</span>
            </div>
          )}

          {!loading && available && checkpoints.length === 0 && !enabled && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>工作区快照未开启</p>
              <span>开启后，Agent 开始新一轮前会按需记录工作区文件状态，之后可把文件恢复到这个状态。</span>
            </div>
          )}

          {!loading && available && checkpoints.length === 0 && enabled && (
            <div className="checkpoint-timeline-empty">
              <Icons.Clock size={20} />
              <p>本会话还没有工作区快照</p>
              <span>当工作区相对上一个快照出现文件变化时，这里会新增记录。</span>
            </div>
          )}

          {!loading && available &&
            checkpoints.map((cp, idx) => {
              const kind = checkpointKindOf(cp)
              const isEngine = kind === 'provider_sdk'
              const invalid = cp.restorable === false && !isEngine
              const disabled = isEngine || cp.restorable === false
              const fileList = fileCache[cp.checkpointId]
              const fileCount = isEngine
                ? cp.filePaths?.length ?? 0
                : cp.fileCount ?? fileList?.length ?? 0
              const isExpanded = expandedId === cp.checkpointId
              const isPreviewing = previewId === cp.checkpointId
              const isRestoring = restoringId === cp.checkpointId
              const isRestoreBackup = isRestoreBackupCheckpoint(cp)
              const seq = checkpoints.length - idx
              const displayId = formatCheckpointDisplayId(cp.checkpointId)
              return (
                <div
                  className={`checkpoint-item${disabled ? ' checkpoint-item-disabled' : ''}`}
                  key={cp.checkpointId}
                >
                  <div className="checkpoint-item-rail">
                    <span className="checkpoint-item-dot" />
                    {idx < checkpoints.length - 1 && <span className="checkpoint-item-line" />}
                  </div>
                  <div className="checkpoint-item-main">
                    <div className="checkpoint-item-head">
                      <span className="checkpoint-item-seq">#{seq}</span>
                      <span
                        className={`checkpoint-item-kind${isEngine ? ' engine' : ''}${invalid ? ' invalid' : ''}`}
                      >
                        {isEngine ? '引擎快照' : '工作区快照'}
                      </span>
                      {isRestoreBackup && <span className="checkpoint-item-id">自动备份</span>}
                      {invalid && <span className="checkpoint-item-invalid-tag">已失效</span>}
                      <span className="checkpoint-item-id">#{displayId}</span>
                      <span className="checkpoint-item-time">{formatRelativeTime(cp.timestamp)}</span>
                    </div>
                    <div className="checkpoint-item-meta">
                      {fileCount > 0 || (isEngine && cp.filePaths != null) ? (
                        <button
                          type="button"
                          className="checkpoint-item-files-toggle"
                          onClick={() => void toggleFileList(cp)}
                        >
                          {isExpanded ? '收起文件' : `查看 ${fileCount} 个文件`}
                        </button>
                      ) : (
                        <span className="checkpoint-item-files-none">无文件清单</span>
                      )}
                      <span className="checkpoint-item-actions">
                        {disabled ? (
                          <span className="checkpoint-item-disabled-note">
                            {isEngine ? '仅上下文锚点，不可还原' : '快照引用已失效'}
                          </span>
                        ) : isPreviewing ? null : (
                          <button
                            type="button"
                            className="checkpoint-item-restore"
                            onClick={() => void handleStartPreview(cp.checkpointId)}
                            disabled={previewLoading || restoringId != null}
                            title="预览还原影响"
                          >
                            预览还原
                          </button>
                        )}
                      </span>
                    </div>
                    {isExpanded && (isEngine ? (cp.filePaths?.length ?? 0) > 0 : true) && (
                      <ul className="checkpoint-item-filelist">
                        {(isEngine ? cp.filePaths ?? [] : fileList ?? []).map((fp) => (
                          <li key={fp} title={fp}>
                            <Icons.File size={11} />
                            <span className="checkpoint-item-filepath">{fp}</span>
                          </li>
                        ))}
                        {!isEngine && fileList == null && (
                          <li>
                            <Icons.Spinner size={11} />
                            <span className="checkpoint-item-filepath">加载文件清单…</span>
                          </li>
                        )}
                      </ul>
                    )}
                    {isPreviewing && (
                      <div className="checkpoint-preview">
                        {previewLoading && (
                          <div className="checkpoint-preview-loading">
                            <Icons.Spinner size={13} /> 正在生成还原预览…
                          </div>
                        )}
                        {previewData != null && (
                          <>
                            <div className="checkpoint-preview-title">将应用此快照，影响如下：</div>
                            <PreviewFileList
                              title="将覆盖回快照内容"
                              files={previewData.modifiedFiles}
                              tone="warn"
                            />
                            <PreviewFileList
                              title="将重建（当前已缺失）"
                              files={previewData.recreatedFiles}
                              tone="warn"
                            />
                            <PreviewFileList
                              title="保持不变"
                              files={previewData.unchangedFiles}
                              tone="ok"
                            />
                            <PreviewFileList
                              title="快照后新增，不受影响"
                              files={previewData.newFilesKept}
                              tone="ok"
                            />
                            <div className="checkpoint-preview-confirm">
                              <span className="checkpoint-preview-confirm-text">
                                还原前会自动备份当前状态；将保留快照后新增的文件。
                              </span>
                              <button
                                type="button"
                                className="btn ghost sm"
                                onClick={() => { setPreviewId(null); setPreviewData(null) }}
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
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
        </div>

        <footer className="checkpoint-timeline-foot">
          <Icons.AlertTriangle size={12} />
          <span>
            快照只恢复工作区文件：非破坏性覆盖快照内文件、保留其后新增的文件；不恢复会话消息或任务进度，也不能证明外部操作已撤销。
          </span>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}
