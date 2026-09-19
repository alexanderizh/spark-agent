import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, Tooltip, message } from 'antd'
import type { CanvasMediaTaskAsset } from '@spark/protocol'
import { Icons } from '../../Icons'
import { MediaArtifactViewer } from '../../components/MediaArtifactViewer'
import { copyTextToClipboard } from './canvasClipboard'
import {
  MODE_ITEMS,
  copyableTaskPrompt,
  modeLabel,
  statusLabel,
  taskOutputUrl,
  textOutputCopyMeta,
  titleForPrompt,
} from './quickCreateTaskPresentation'
import {
  readQuickCreatePreferences,
  writeQuickCreatePreferences,
  type QuickCreateTaskViewMode,
} from './quickCreatePreferences'
import type { QuickCreateMode, QuickCreateTaskRecord } from './quickCreateTaskStore'
import './QuickCreateTaskHistory.less'

type HistoryProps = {
  tasks: QuickCreateTaskRecord[]
  expandedTaskId: string | null
  onRowActivate: (task: QuickCreateTaskRecord) => void
  onReuse: (task: QuickCreateTaskRecord) => void
  onCancel: (task: QuickCreateTaskRecord) => void
  onRetry: (task: QuickCreateTaskRecord) => void
  onDelete: (taskId: string) => void
  onOpenOutput: (asset: CanvasMediaTaskAsset) => void
  onSavePrompt: (task: QuickCreateTaskRecord) => void
}

/** 任务内可独立查看的产物：已解析出 URL 的图片 / 视频。 */
type TaskViewableOutput = {
  asset: CanvasMediaTaskAsset
  url: string
}

function viewableOutputsOf(task: QuickCreateTaskRecord): TaskViewableOutput[] {
  return task.assets
    .map((asset) => {
      const url = taskOutputUrl(asset)
      const viewable = url !== '' && (asset.type === 'image' || asset.type === 'video')
      return viewable ? { asset, url } : null
    })
    .filter((item): item is TaskViewableOutput => item != null)
}

/** 独立产物查看：taskId + 可查看产物列表下标；不切换创作结果区块。 */
type ViewerTarget = { taskId: string; outputIndex: number }

async function copyTaskPrompt(prompt: string, doneMessage = '提示词已复制') {
  try {
    await copyTextToClipboard(prompt)
    message.success(doneMessage)
  } catch {
    message.error('复制提示词失败')
  }
}

/**
 * 详情内文本块（提示词 / 反推提示词）：label 后带一键复制；clamp 时默认折叠（clampLines 行）、
 * 溢出可手动展开；展开后若传入 expandedMaxHeight 则固定高度内部滚动，避免长文本挤压图片或撑高弹层；
 * 空文本（如反推任务的输入提示词）不出现复制按钮。
 */
function DetailPrompt({
  prompt,
  label = '提示词',
  doneMessage = '提示词已复制',
  clamp = false,
  clampLines = 3,
  expandedMaxHeight,
}: {
  prompt: string
  label?: string
  doneMessage?: string
  clamp?: boolean
  clampLines?: number
  expandedMaxHeight?: string
}) {
  const textRef = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowed, setOverflowed] = useState(false)

  useEffect(() => {
    if (!clamp || expanded) return
    const el = textRef.current
    if (!el) return
    // line-clamp 只做视觉截断，scrollHeight 仍是全量内容高；与可见高比较判断是否溢出
    setOverflowed(el.scrollHeight > el.clientHeight + 1)
  }, [clamp, expanded, prompt])

  const clamped = clamp && !expanded
  const expandedScroll = clamp && expanded && expandedMaxHeight !== undefined

  return (
    <div className="quick-create-detail-prompt">
      <div className="quick-create-detail-prompt-label">
        <span>{label}</span>
        {prompt.trim() && (
          <button
            type="button"
            aria-label={`复制${label}`}
            title={`复制${label}`}
            onClick={() => void copyTaskPrompt(prompt, doneMessage)}
          >
            <Icons.Copy size={12} />
          </button>
        )}
      </div>
      <p
        ref={textRef}
        className={clamped ? 'is-clamped' : undefined}
        style={
          clamped
            ? { WebkitLineClamp: clampLines }
            : expandedScroll
              ? { maxHeight: expandedMaxHeight, overflowY: 'auto' }
              : undefined
        }
      >
        {prompt || '图片反推任务'}
      </p>
      {clamp && (expanded || overflowed) && (
        <button
          type="button"
          className="quick-create-prompt-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

/**
 * 任务管理 Tab：顶部保留概览 / 模式筛选，右侧提供 列表 / 卡片 视图切换。
 * 列表视图为可展开行；卡片视图以瀑布流只呈现产物图片，点击图片打开详情弹层。
 * 详情内的图片 / 视频在独立弹层中查看，不影响右侧创作结果的当前任务。
 */
export function QuickCreateTaskHistory({
  tasks,
  expandedTaskId,
  onRowActivate,
  onReuse,
  onCancel,
  onRetry,
  onDelete,
  onOpenOutput,
  onSavePrompt,
}: HistoryProps) {
  const [filter, setFilter] = useState<QuickCreateMode | 'all'>(
    () => readQuickCreatePreferences().taskFilter ?? 'all',
  )
  const [view, setView] = useState<QuickCreateTaskViewMode>(
    () => readQuickCreatePreferences().taskView ?? 'list',
  )
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerTarget | null>(null)

  const visibleTasks = useMemo(
    () => (filter === 'all' ? tasks : tasks.filter((task) => task.mode === filter)),
    [filter, tasks],
  )
  const cardTasks = useMemo(
    () => visibleTasks.filter((task) => task.assets.some((asset) => asset.type === 'image')),
    [visibleTasks],
  )
  const detailTask = useMemo(
    () => (detailTaskId ? (tasks.find((task) => task.id === detailTaskId) ?? null) : null),
    [detailTaskId, tasks],
  )
  const detailOutputs = useMemo(
    () => (detailTask ? viewableOutputsOf(detailTask) : []),
    [detailTask],
  )
  const viewerTask = useMemo(
    () => (viewer ? (tasks.find((task) => task.id === viewer.taskId) ?? null) : null),
    [viewer, tasks],
  )
  const viewerOutputs = useMemo(
    () => (viewerTask ? viewableOutputsOf(viewerTask) : []),
    [viewerTask],
  )
  const viewerOutput =
    viewer && viewerOutputs.length > 0
      ? (viewerOutputs[Math.min(viewer.outputIndex, viewerOutputs.length - 1)] ?? null)
      : null
  const viewerIndex = viewerOutput ? viewerOutputs.indexOf(viewerOutput) : 0

  const changeView = (next: QuickCreateTaskViewMode) => {
    setView(next)
    writeQuickCreatePreferences({ ...readQuickCreatePreferences(), taskView: next })
  }

  // 筛选与视图同属「展示状态」，切换后一并持久化，下次进入保持原样
  const changeFilter = (next: QuickCreateMode | 'all') => {
    setFilter(next)
    writeQuickCreatePreferences({ ...readQuickCreatePreferences(), taskFilter: next })
  }

  // danger 变体用于「移除记录」这类破坏性操作：hover / focus 走危险色，与其它只读操作区分
  const renderListAction = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    options?: { danger?: boolean },
  ) => (
    <Tooltip title={label} placement="top">
      <Button
        type="text"
        size="small"
        className={`quick-create-list-action${options?.danger ? ' is-danger' : ''}`}
        icon={icon}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
      />
    </Tooltip>
  )

  const renderListActions = (task: QuickCreateTaskRecord, output?: CanvasMediaTaskAsset) => {
    // 反推任务没有输入提示词，可复制的提示词是它的产物（task.text）
    const copyTarget = copyableTaskPrompt(task)
    return (
      <div className="quick-create-list-actions" aria-label="任务操作">
        {copyTarget &&
          renderListAction(copyTarget.label, <Icons.Copy size={14} />, () => {
            void copyTaskPrompt(copyTarget.text, copyTarget.doneMessage)
          })}
        {task.status !== 'running' &&
          renderListAction(
            task.status === 'succeeded' ? '重新生成' : '重试',
            <Icons.RotateCcw size={14} />,
            () => onRetry(task),
          )}
        {renderListAction('复用配置', <Icons.Repeat size={14} />, () => onReuse(task))}
        {task.prompt.trim() &&
          renderListAction('存入提示词库', <Icons.Book size={14} />, () => onSavePrompt(task))}
        {output?.filePath &&
          renderListAction('打开产物', <Icons.FolderOpen size={14} />, () => {
            void onOpenOutput(output)
          })}
        {renderListAction('移除记录', <Icons.Trash size={14} />, () => onDelete(task.id), {
          danger: true,
        })}
      </div>
    )
  }

  const renderTaskActions = (task: QuickCreateTaskRecord, output?: CanvasMediaTaskAsset) => (
    <div className="quick-create-task-actions">
      {task.status === 'running' && task.runtimeTaskId && (
        <Button size="small" type="text" onClick={() => void onCancel(task)}>
          取消任务
        </Button>
      )}
      {task.status !== 'running' && (
        <Button
          size="small"
          type="text"
          icon={<Icons.RotateCcw size={13} />}
          onClick={() => onRetry(task)}
        >
          {task.status === 'succeeded' ? '重新生成' : '重试'}
        </Button>
      )}
      <Button size="small" type="text" onClick={() => onReuse(task)}>
        复用配置
      </Button>
      {task.prompt.trim() && (
        <Button
          size="small"
          type="text"
          icon={<Icons.Book size={13} />}
          onClick={() => onSavePrompt(task)}
        >
          存入提示词库
        </Button>
      )}
      {output?.filePath && (
        <Button size="small" type="text" onClick={() => void onOpenOutput(output)}>
          打开产物
        </Button>
      )}
      <Button
        size="small"
        type="text"
        danger
        className="quick-create-task-remove"
        onClick={() => onDelete(task.id)}
      >
        移除记录
      </Button>
    </div>
  )

  return (
    <section className="quick-create-history" aria-label="任务管理">
      <div className="quick-create-history-head">
        <div className="quick-create-history-overview">
          <strong>
            {tasks.some((task) => task.status === 'running')
              ? `${tasks.filter((task) => task.status === 'running').length} 个任务处理中`
              : '任务队列空闲'}
          </strong>
          <span>
            {tasks.length} 条记录 · {tasks.filter((task) => task.status === 'succeeded').length} 个
            已完成
          </span>
        </div>
        <div className="quick-create-history-tools">
          <div className="quick-create-history-filters" role="tablist" aria-label="记录筛选">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={filter === 'all' ? 'is-active' : ''}
              onClick={() => changeFilter('all')}
            >
              全部 <small>{tasks.length}</small>
            </button>
            {MODE_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filter === item.id}
                className={filter === item.id ? 'is-active' : ''}
                onClick={() => changeFilter(item.id)}
              >
                {item.label}
                <small>{tasks.filter((task) => task.mode === item.id).length}</small>
              </button>
            ))}
          </div>
          <div className="quick-create-view-toggle" role="radiogroup" aria-label="任务展示方式">
            <button
              type="button"
              role="radio"
              aria-checked={view === 'list'}
              aria-label="列表视图"
              title="列表视图"
              className={view === 'list' ? 'is-active' : ''}
              onClick={() => changeView('list')}
            >
              <Icons.Menu size={14} />
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view === 'grid'}
              aria-label="卡片视图"
              title="卡片视图"
              className={view === 'grid' ? 'is-active' : ''}
              onClick={() => changeView('grid')}
            >
              <Icons.Grid size={14} />
            </button>
          </div>
        </div>
      </div>

      {view === 'grid' ? (
        cardTasks.length === 0 ? (
          <div className="quick-create-history-empty">
            <Icons.History size={20} />
            <strong>还没有可展示的产物图片</strong>
            <span>卡片视图只显示已生成图片的任务，可切换回列表查看全部记录。</span>
          </div>
        ) : (
          <div className="quick-create-card-grid">
            {cardTasks.map((task) => {
              const cover = task.assets.find((asset) => asset.type === 'image')
              const coverUrl = taskOutputUrl(cover)
              const imageCount = task.assets.filter((asset) => asset.type === 'image').length
              return (
                <article className="quick-create-card" key={task.id}>
                  <button
                    type="button"
                    className="quick-create-card-media"
                    aria-label={`查看详情：${titleForPrompt(task.prompt, task.mode)}`}
                    onClick={() => setDetailTaskId(task.id)}
                  >
                    <img
                      src={coverUrl}
                      alt={titleForPrompt(task.prompt, task.mode)}
                      loading="lazy"
                    />
                    <span className="quick-create-card-veil" aria-hidden="true">
                      <strong>{titleForPrompt(task.prompt, task.mode)}</strong>
                      <small>{new Date(task.createdAt).toLocaleString()}</small>
                    </span>
                  </button>
                  {task.status !== 'succeeded' && (
                    <span className={`quick-create-task-status is-${task.status}`}>
                      <i />
                      {statusLabel(task.status)}
                    </span>
                  )}
                  {imageCount > 1 && (
                    <span className="quick-create-card-count">{imageCount} 图</span>
                  )}
                </article>
              )
            })}
          </div>
        )
      ) : (
        <div className="quick-create-history-list">
          {visibleTasks.length === 0 ? (
            <div className="quick-create-history-empty">
              <Icons.History size={20} />
              <strong>还没有创作任务</strong>
              <span>完成第一次生成后，任务会出现在这里。</span>
            </div>
          ) : (
            visibleTasks.map((task, index) => {
              const output = task.assets[0]
              const localOutput = task.assets.find((asset) => Boolean(asset.filePath))
              const taskOutputs = viewableOutputsOf(task)
              const firstOutput = taskOutputs[0]
              const expanded = expandedTaskId === task.id
              const textMeta = textOutputCopyMeta(task.mode)
              return (
                <article
                  className={`quick-create-task${expanded ? ' is-expanded' : ''}`}
                  key={task.id}
                >
                  <div className="quick-create-task-row">
                    <button
                      type="button"
                      className="quick-create-task-main"
                      onClick={() => onRowActivate(task)}
                    >
                      <span className="quick-create-task-index" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="quick-create-task-state">
                        <span className={`quick-create-task-status is-${task.status}`}>
                          <i />
                          {statusLabel(task.status)}
                        </span>
                        {task.status === 'running' && task.progress !== undefined && (
                          <small>{Math.round(task.progress)}%</small>
                        )}
                      </span>
                      <span className="quick-create-task-copy">
                        <strong>{titleForPrompt(task.prompt, task.mode)}</strong>
                        <small>
                          {modeLabel(task.mode)} ·{' '}
                          {task.modelName ?? task.modelId ?? '自动选择模型'} ·{' '}
                          {new Date(task.createdAt).toLocaleString()}
                        </small>
                      </span>
                      {firstOutput && firstOutput.asset.type === 'image' ? (
                        <img src={firstOutput.url} alt="生成结果预览" />
                      ) : firstOutput ? (
                        <video src={firstOutput.url} muted />
                      ) : task.text ? (
                        <span className="quick-create-text-preview">{task.text.slice(0, 80)}</span>
                      ) : (
                        <span className="quick-create-task-placeholder">
                          <Icons.Clock size={15} />
                        </span>
                      )}
                      <Icons.ChevronDown size={15} className={expanded ? 'is-open' : ''} />
                    </button>
                    {renderListActions(task, localOutput)}
                  </div>
                  {expanded && (
                    <div className="quick-create-task-detail">
                      <DetailPrompt prompt={task.prompt} clamp />
                      {task.error && (
                        <div className="quick-create-task-error">
                          <Icons.AlertTriangle size={14} /> {task.error.message}
                        </div>
                      )}
                      <div className="quick-create-detail-meta">
                        <span>{modeLabel(task.mode)}</span>
                        <span>{task.modelName ?? task.modelId ?? '自动选择模型'}</span>
                        {task.status === 'running' && task.progress !== undefined && (
                          <span>进度 {Math.round(task.progress)}%</span>
                        )}
                      </div>
                      {task.text && (
                        <DetailPrompt
                          prompt={task.text}
                          label={textMeta.label}
                          doneMessage={textMeta.doneMessage}
                          clamp
                        />
                      )}
                      {firstOutput && (
                        <button
                          type="button"
                          className="quick-create-history-output-thumb"
                          onClick={() => setViewer({ taskId: task.id, outputIndex: 0 })}
                        >
                          {firstOutput.asset.type === 'image' ? (
                            <img src={firstOutput.url} alt="生成结果缩略图" />
                          ) : (
                            <video src={firstOutput.url} muted />
                          )}
                          <span>
                            {firstOutput.asset.type === 'video' ? '查看视频' : '查看大图'}
                          </span>
                        </button>
                      )}
                      {renderTaskActions(task, output)}
                    </div>
                  )}
                </article>
              )
            })
          )}
        </div>
      )}

      {detailTask && (
        <Modal
          open
          width={680}
          centered
          footer={null}
          title={null}
          className="quick-create-task-detail-modal"
          closeIcon={<Icons.X size={15} />}
          onCancel={() => setDetailTaskId(null)}
        >
          <div className="quick-create-detail-body">
            <div className="quick-create-detail-head">
              <span className={`quick-create-task-status is-${detailTask.status}`}>
                <i />
                {statusLabel(detailTask.status)}
              </span>
              <strong>{titleForPrompt(detailTask.prompt, detailTask.mode)}</strong>
              <small>
                {modeLabel(detailTask.mode)} ·{' '}
                {detailTask.modelName ?? detailTask.modelId ?? '自动选择模型'} ·{' '}
                {new Date(detailTask.createdAt).toLocaleString()}
              </small>
            </div>
            {detailOutputs.length > 0 ? (
              <button
                type="button"
                className="quick-create-detail-media"
                aria-label="查看大图"
                onClick={() => setViewer({ taskId: detailTask.id, outputIndex: 0 })}
              >
                {detailOutputs[0]?.asset.type === 'video' ? (
                  <video src={detailOutputs[0]?.url} muted />
                ) : (
                  <img src={detailOutputs[0]?.url} alt="生成结果" />
                )}
                {detailOutputs.length > 1 && (
                  <span className="quick-create-detail-count">
                    点击放大 · {detailOutputs.length} 图
                  </span>
                )}
              </button>
            ) : detailTask.status === 'running' ? (
              <div className="quick-create-detail-pending">
                <Icons.Clock size={16} />
                <span>任务处理中，完成后这里会显示产物图片。</span>
              </div>
            ) : (
              <div className="quick-create-detail-pending">
                <Icons.Image size={16} />
                <span>这条任务没有产物图片。</span>
              </div>
            )}
            {/* 弹窗提示词默认 2 行折叠；展开后固定高度内部滚动，产物图区域不被长提示词挤压 */}
            <DetailPrompt
              prompt={detailTask.prompt}
              clamp
              clampLines={2}
              expandedMaxHeight="min(36vh, 240px)"
            />
            {detailTask.error && (
              <div className="quick-create-task-error">
                <Icons.AlertTriangle size={14} /> {detailTask.error.message}
              </div>
            )}
            {renderTaskActions(detailTask, detailTask.assets[0])}
          </div>
        </Modal>
      )}

      {viewer && viewerTask && viewerOutput && (
        <Modal
          open
          width="min(1240px, 94vw)"
          centered
          footer={null}
          title={null}
          className="quick-create-media-viewer-modal"
          closeIcon={<Icons.X size={15} />}
          onCancel={() => setViewer(null)}
        >
          <div className="quick-create-media-viewer-body">
            <MediaArtifactViewer
              media={{
                src: viewerOutput.url,
                alt: viewerOutput.asset.title ?? '生成结果',
                fileName:
                  viewerOutput.asset.filePath?.split(/[\\/]/).pop() ||
                  `quick-create-output.${viewerOutput.asset.type === 'video' ? 'mp4' : 'png'}`,
                ...(viewerOutput.asset.filePath ? { filePath: viewerOutput.asset.filePath } : {}),
                type: viewerOutput.asset.type === 'video' ? 'video' : 'image',
              }}
              pagination={
                viewerOutputs.length > 1
                  ? {
                      index: viewerIndex,
                      total: viewerOutputs.length,
                      onPrev: () =>
                        setViewer((current) =>
                          current
                            ? {
                                ...current,
                                outputIndex:
                                  (viewerIndex - 1 + viewerOutputs.length) % viewerOutputs.length,
                              }
                            : current,
                        ),
                      onNext: () =>
                        setViewer((current) =>
                          current
                            ? { ...current, outputIndex: (viewerIndex + 1) % viewerOutputs.length }
                            : current,
                        ),
                    }
                  : undefined
              }
            />
          </div>
        </Modal>
      )}
    </section>
  )
}
