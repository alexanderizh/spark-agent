import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, Tooltip, message } from 'antd'
import type { CanvasMediaTaskAsset } from '@spark/protocol'
import { Icons } from '../../Icons'
import { ContextMenu } from '../../components/ContextMenu'
import { useContextMenu, type ContextMenuEntry } from '../../components/contextMenuModel'
import { MediaArtifactViewer } from '../../components/MediaArtifactViewer'
import {
  copyMediaImage,
  revealMediaArtifact,
  saveMediaArtifact,
} from '../../components/mediaArtifactActions'
import { useArrowPaging } from '../../hooks/useArrowPaging'
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
  buildQuickCreateTaskMenuItems,
  outputKeyOf,
  viewableOutputsOf,
  type QuickCreateTaskMenuHandlers,
  type QuickCreateMenuTarget,
} from './quickCreateTaskContextMenu'
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

/** 独立产物查看：taskId + 可查看产物列表下标；不切换创作结果区块。 */
type ViewerTarget = { taskId: string; outputIndex: number }

/** 右键来源界面：决定「查看详情」这一项的文案与行为 */
type HistorySurface = 'card' | 'row' | 'detail'

type HistoryMenuTarget = QuickCreateMenuTarget & { surface: HistorySurface }

async function copyTaskPrompt(prompt: string, doneMessage = '提示词已复制') {
  try {
    await copyTextToClipboard(prompt)
    message.success(doneMessage)
  } catch {
    message.error('复制提示词失败')
  }
}

function outputFileName(asset: CanvasMediaTaskAsset, fallback: string): string {
  return asset.filePath?.split(/[\\/]/).pop() || fallback
}

/** 右键菜单里的图片复制：与查看器同一套公用动作，成功/失败都给出明确反馈 */
async function copyTaskImage(url: string) {
  try {
    await copyMediaImage(url)
    message.success('已复制到剪贴板')
  } catch (error) {
    message.error(`复制失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function saveTaskOutput(asset: CanvasMediaTaskAsset) {
  try {
    const result = await saveMediaArtifact({
      filePath: asset.filePath,
      fileName: outputFileName(
        asset,
        `quick-create-output.${asset.type === 'video' ? 'mp4' : 'png'}`,
      ),
    })
    if (result.saved && result.savedPath) message.success(`已保存到 ${result.savedPath}`)
    else if (result.error) message.error(`保存失败：${result.error}`)
  } catch (error) {
    message.error(`保存失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

async function revealTaskOutput(asset: CanvasMediaTaskAsset) {
  if (!asset.filePath) return
  try {
    const result = await revealMediaArtifact(asset.filePath)
    if (!result.revealed) message.error(result.error ?? '打开产物所在文件夹失败')
  } catch (error) {
    message.error(
      `打开产物所在文件夹失败：${error instanceof Error ? error.message : String(error)}`,
    )
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
 *
 * 翻页：详情弹层可 ←/→（或点头部按钮）切到当前视图里的上 / 下一个任务；
 * 产物查看弹层可 ←/→（或点工具栏按钮）在当前视图的全部可查看产物间连续翻页，
 * 跨任务时工具栏会标出当前产物属于哪条任务。
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
  // 右键目标带上来源界面：卡片「查看详情」开弹层，列表行「展开/收起」走原有行激活
  const taskMenu = useContextMenu<HistoryMenuTarget>()

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
  // 翻页顺序跟用户当前看到的任务顺序一致：卡片视图走瀑布流里的任务，列表视图走筛选后的列表
  const pagedTasks = view === 'grid' ? cardTasks : visibleTasks

  const detailIndex = detailTask ? pagedTasks.findIndex((task) => task.id === detailTask.id) : -1
  const detailCanPage = detailTask !== null && detailIndex >= 0 && pagedTasks.length > 1

  /** 当前视图里所有可查看产物拍平成的翻页序列（跨任务连续翻页） */
  const viewerSequence = useMemo(
    () =>
      pagedTasks.flatMap((task) =>
        viewableOutputsOf(task).map((_, outputIndex) => ({ taskId: task.id, outputIndex })),
      ),
    [pagedTasks],
  )

  // 查看目标用「任务 id + 产物下标」定位，任务被刷新后仍在序列里找到原位置
  const viewerIndex = viewer
    ? viewerSequence.findIndex(
        (item) => item.taskId === viewer.taskId && item.outputIndex === viewer.outputIndex,
      )
    : -1
  const viewerItem = viewerIndex >= 0 ? (viewerSequence[viewerIndex] ?? null) : null
  const viewerTask = viewerItem
    ? (tasks.find((task) => task.id === viewerItem.taskId) ?? null)
    : null
  const viewerOutputs = useMemo(
    () => (viewerTask ? viewableOutputsOf(viewerTask) : []),
    [viewerTask],
  )
  const viewerOutput = viewerItem ? (viewerOutputs[viewerItem.outputIndex] ?? null) : null

  // 记录被移除 / 产物被替换后目标可能已不存在：渲染期收起弹层，
  // 既不让失效状态留在 state 里（否则下次打开会误判为「弹层已开」），也避免 effect 内 setState 的级联渲染
  if (viewer && (!viewerItem || !viewerTask || !viewerOutput)) setViewer(null)

  const stepDetailTask = (delta: number) => {
    if (!detailTask || pagedTasks.length < 2) return
    const index = pagedTasks.findIndex((task) => task.id === detailTask.id)
    if (index < 0) return
    const next = pagedTasks[(index + delta + pagedTasks.length) % pagedTasks.length]
    if (next) setDetailTaskId(next.id)
  }

  const stepViewer = (delta: number) => {
    if (viewerSequence.length < 2) return
    const current = viewerSequence[viewerIndex]
    if (!current) return
    const next =
      viewerSequence[(viewerIndex + delta + viewerSequence.length) % viewerSequence.length]
    if (next) setViewer({ taskId: next.taskId, outputIndex: next.outputIndex })
  }

  // 详情弹层打开时 ←/→ 切任务；产物查看弹层盖在上面时由它自己接管键盘
  useArrowPaging({
    enabled: detailCanPage && viewerOutput === null,
    onPrev: () => stepDetailTask(-1),
    onNext: () => stepDetailTask(1),
  })

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

  const menuState = taskMenu.menu
  const menuTask = menuState
    ? (tasks.find((task) => task.id === menuState.target.taskId) ?? null)
    : null

  /**
   * 右键菜单的任务动作全部复用既有 props，不另建一套任务逻辑：
   * 「查看详情」按来源界面分派——卡片开弹层，列表行走原有展开/收起。
   */
  const buildMenuHandlers = (target: HistoryMenuTarget): QuickCreateTaskMenuHandlers => ({
    onToggleDetail:
      target.surface === 'card'
        ? (task) => setDetailTaskId(task.id)
        : target.surface === 'row'
          ? (task) => onRowActivate(task)
          : undefined,
    detailOpen: target.surface === 'row' && expandedTaskId === target.taskId,
    onViewOutput: (task, outputIndex) => setViewer({ taskId: task.id, outputIndex }),
    onCopyPrompt: (text, doneMessage) => void copyTaskPrompt(text, doneMessage),
    onCopyImage: (url) => void copyTaskImage(url),
    onSaveOutput: (asset) => void saveTaskOutput(asset),
    onRevealOutput: (asset) => void revealTaskOutput(asset),
    onReuse,
    onRetry,
    onSavePrompt,
    onDelete,
  })

  // 产物查看弹层的追加项：只给任务级动作（assetRef=null），产物自身动作由 viewer 内置提供
  const viewerMenuItems: ContextMenuEntry[] = viewerTask
    ? buildQuickCreateTaskMenuItems(
        viewerTask,
        { taskId: viewerTask.id, assetRef: null },
        buildMenuHandlers({ taskId: viewerTask.id, assetRef: null, surface: 'detail' }),
      )
    : []

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
                <article
                  className="quick-create-card"
                  key={task.id}
                  onContextMenu={(event) =>
                    taskMenu.open(event, {
                      taskId: task.id,
                      assetRef: cover?.filePath ?? (coverUrl || null),
                      surface: 'card',
                    })
                  }
                >
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
                  onContextMenu={(event) =>
                    taskMenu.open(event, {
                      taskId: task.id,
                      assetRef: firstOutput ? outputKeyOf(firstOutput) : null,
                      surface: 'row',
                    })
                  }
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
          <div
            className="quick-create-detail-body"
            onContextMenu={(event) =>
              taskMenu.open(event, {
                taskId: detailTask.id,
                assetRef: detailOutputs[0] ? outputKeyOf(detailOutputs[0]) : null,
                surface: 'detail',
              })
            }
          >
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
            {detailCanPage && (
              <div className="quick-create-detail-pager" role="group" aria-label="切换任务">
                <button
                  type="button"
                  aria-label="上一个任务"
                  title="上一个任务（←）"
                  onClick={() => stepDetailTask(-1)}
                >
                  <Icons.ChevronLeft size={14} />
                </button>
                <span>
                  {detailIndex + 1} / {pagedTasks.length}
                </span>
                <button
                  type="button"
                  aria-label="下一个任务"
                  title="下一个任务（→）"
                  onClick={() => stepDetailTask(1)}
                >
                  <Icons.ChevronRight size={14} />
                </button>
              </div>
            )}
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
                viewerSequence.length > 1
                  ? {
                      index: viewerIndex,
                      total: viewerSequence.length,
                      label: titleForPrompt(viewerTask.prompt, viewerTask.mode),
                      onPrev: () => stepViewer(-1),
                      onNext: () => stepViewer(1),
                    }
                  : undefined
              }
              // 大图上右键同样能操作所属任务（复制提示词 / 重试 / 删除任务等）；
              // 产物自身的复制、另存为、所在文件夹由 viewer 内置动作提供
              contextMenuExtraItems={viewerMenuItems}
            />
          </div>
        </Modal>
      )}

      {menuState && menuTask && (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          items={buildQuickCreateTaskMenuItems(
            menuTask,
            { taskId: menuState.target.taskId, assetRef: menuState.target.assetRef },
            buildMenuHandlers(menuState.target),
          )}
          onClose={taskMenu.close}
          ariaLabel="任务操作"
        />
      )}
    </section>
  )
}
