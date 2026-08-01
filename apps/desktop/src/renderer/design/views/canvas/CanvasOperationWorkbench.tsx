import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Modal, Popover, Progress } from 'antd'
import { Icons } from '../../Icons'
import { CanvasNodeEditModal } from './CanvasNodeEditModal'
import { CanvasOperationNodeSettings } from './CanvasOperationNodeSettings'
import { CanvasOperationOutputPreview } from './CanvasOperationOutputPreview'
import {
  resolveCanvasOperationOutputState,
  selectCanvasOperationOutputs,
} from './canvasOperationOutputModel'
import { buildCanvasOperationParamSummary } from './canvasOperationParamSummary'
import {
  buildCanvasOperationRunViews,
  canvasOperationRunsFingerprint,
  type CanvasOperationOutputView,
  type CanvasOperationRunView,
} from './canvasOperationRuns'
import {
  createCanvasOperationWorkbenchState,
  reduceCanvasOperationWorkbenchState,
  type CanvasOperationWorkbenchTab,
} from './canvasOperationWorkbenchState'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'
import './CanvasOperationWorkbench.less'

function runStatusLabel(status: string): string {
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '待提交'
}

const OUTPUT_MODE_LABEL = {
  single: '单产物',
  candidates: '候选产物',
  collection: '产物集合',
  bundle: '产物包',
} as const

export function CanvasOperationWorkbench({
  node,
  snapshot,
  configPanel,
  onRenameNode,
  onSaveOutput,
  onDownloadOutput,
  onPreviewPanoramaOutput,
  onOpenAssetLibrary,
  onSetPrimaryOutput,
  onExpandOutputs,
  onDeleteOutputs,
  onDeleteRun,
  fullscreen = false,
  onFullscreenChange,
}: {
  node: CanvasNode
  snapshot: CanvasSnapshot
  configPanel: ReactNode
  onRenameNode: (title: string | null) => Promise<void> | void
  onSaveOutput: (
    node: CanvasNode,
    patch: Partial<CanvasNode>,
    data: CanvasNode['data'],
  ) => Promise<void>
  onDownloadOutput?: (nodeId: string) => void
  onPreviewPanoramaOutput?: (nodeId: string) => void
  onOpenAssetLibrary?: (assetId: string) => void
  onSetPrimaryOutput?: (output: CanvasOperationOutputView) => Promise<void> | void
  onExpandOutputs?: (outputs: CanvasOperationOutputView[]) => Promise<void> | void
  onDeleteOutputs?: (outputs: CanvasOperationOutputView[]) => Promise<void> | void
  onDeleteRun?: (run: CanvasOperationRunView) => Promise<void> | void
  fullscreen?: boolean
  onFullscreenChange?: (fullscreen: boolean) => void
}) {
  const runs = useMemo(() => buildCanvasOperationRunViews(node, snapshot), [node, snapshot])
  const outputState = useMemo(() => resolveCanvasOperationOutputState(node, runs), [node, runs])
  const outputCount = runs.reduce((total, run) => total + run.outputs.length, 0)
  const hasOutputs = outputCount > 0
  const [state, dispatch] = useReducer(reduceCanvasOperationWorkbenchState, undefined, () =>
    createCanvasOperationWorkbenchState(
      hasOutputs,
      outputState.primaryRunIndex,
      outputState.primaryOutputIndex,
    ),
  )
  const runsFingerprint = canvasOperationRunsFingerprint(runs)

  useEffect(() => {
    dispatch({
      type: 'sync-primary',
      hasOutputs,
      runIndex: outputState.primaryRunIndex,
      outputIndex: outputState.primaryOutputIndex,
    })
  }, [
    hasOutputs,
    node.data.primaryOutputId,
    outputState.primaryOutputIndex,
    outputState.primaryRunIndex,
    runsFingerprint,
  ])

  const effectiveRunIndex = Math.min(state.runIndex, Math.max(0, runs.length - 1))
  const activeRun = runs[effectiveRunIndex]
  const outputs = activeRun?.outputs ?? []
  const effectiveOutputIndex = Math.min(state.outputIndex, Math.max(0, outputs.length - 1))
  const activeOutput = outputs[effectiveOutputIndex]
  const activeOutputAssetId = activeOutput?.assetId
  const outputNode = activeOutput?.nodeId
    ? (snapshot.nodes.find((item) => item.id === activeOutput.nodeId) ?? null)
    : null
  const activeTab: CanvasOperationWorkbenchTab =
    !hasOutputs && (state.tab === 'output' || state.tab === 'history') ? 'config' : state.tab
  const selectedOutputIdSet = new Set(state.selectedOutputIds)
  const selectedOutputs = outputs.filter((output) => selectedOutputIdSet.has(output.id))
  const allCurrentRunSelected =
    outputs.length > 0 && outputs.every((output) => selectedOutputIdSet.has(output.id))
  const displayRunNumber = activeRun ? runs.length - effectiveRunIndex : 0
  const canDownload = Boolean(
    outputNode && (activeOutput?.type === 'image' || activeOutput?.type === 'video'),
  )
  const canPreviewPanorama = Boolean(outputNode && activeOutput?.panorama360)
  const isPrimaryOutput = Boolean(
    activeOutput && outputState.primaryOutput && activeOutput.id === outputState.primaryOutput.id,
  )
  const primaryActionLabel = outputState.mode === 'collection' ? '设为默认预览' : '设为主产物'
  const latestRun = runs[0]
  const isLatestRunRunning = latestRun?.status === 'running'
  const runBannerParamSummary = isLatestRunRunning
    ? buildCanvasOperationParamSummary(node.data.modelParams, 3)
    : []

  const confirmRunDeletion = (run: CanvasOperationRunView) => {
    if (!onDeleteRun || state.busy) return
    Modal.confirm({
      title: '删除这次运行记录？',
      content: '该运行的任务记录、连线与产物节点会同步清理；资源库中的资产仍会保留。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        dispatch({ type: 'set-busy', busy: true })
        try {
          await onDeleteRun(run)
        } finally {
          dispatch({ type: 'set-busy', busy: false })
        }
      },
    })
  }

  const runExpansion = async (targetOutputs: CanvasOperationOutputView[]) => {
    if (!onExpandOutputs || targetOutputs.length === 0 || state.busy) return
    dispatch({ type: 'set-busy', busy: true })
    try {
      await onExpandOutputs(targetOutputs)
    } finally {
      dispatch({ type: 'set-busy', busy: false })
    }
  }

  const confirmOutputDeletion = (targetOutputs: CanvasOperationOutputView[]) => {
    if (!onDeleteOutputs || targetOutputs.length === 0 || state.busy) return
    Modal.confirm({
      title:
        targetOutputs.length === 1
          ? '删除这个产物？'
          : `删除选中的 ${targetOutputs.length} 个产物？`,
      content: '产物将从当前任务中移除，对应画布节点和连线会同步清理；资源库中的资产仍会保留。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        dispatch({ type: 'set-busy', busy: true })
        try {
          await onDeleteOutputs(targetOutputs)
          dispatch({ type: 'finish-output-deletion' })
        } finally {
          dispatch({ type: 'set-busy', busy: false })
        }
      },
    })
  }

  const tabButton = (
    tab: CanvasOperationWorkbenchTab,
    label: string,
    icon: ReactNode,
    count?: number,
  ) => (
    <button
      type="button"
      className={`canvas-operation-workbench-tab${activeTab === tab ? ' is-active' : ''}`}
      disabled={(tab === 'output' || tab === 'history') && !hasOutputs}
      onClick={() => dispatch({ type: 'select-tab', tab })}
    >
      {icon}
      {label}
      {count ? <span className="canvas-operation-workbench-count">{count}</span> : null}
    </button>
  )

  return (
    <div className={`canvas-operation-workbench${fullscreen ? ' is-fullscreen' : ''}`}>
      {!state.editingOutput ? (
        <div className="canvas-operation-workbench-head">
          <div className="canvas-operation-workbench-tabs">
            {tabButton('output', '产物', <Icons.File size={13} />, outputCount)}
            {tabButton('config', '任务配置', <Icons.Settings size={13} />)}
            {tabButton('settings', '节点设置', <Icons.Edit size={13} />)}
            {tabButton('history', '运行历史', <Icons.RotateCcw size={13} />, runs.length)}
          </div>
          {activeTab === 'output' && activeRun ? (
            <div className="canvas-operation-workbench-context">
              <div className="canvas-operation-workbench-run-nav">
                <button
                  type="button"
                  aria-label="查看更新的一次运行"
                  disabled={effectiveRunIndex === 0}
                  onClick={() => dispatch({ type: 'select-run', runIndex: effectiveRunIndex - 1 })}
                >
                  <Icons.ChevronLeft size={14} />
                </button>
                <span className="canvas-operation-workbench-run-label">
                  第 {displayRunNumber} 次{runs.length > 1 ? ` / ${runs.length}` : ''}
                </span>
                <button
                  type="button"
                  aria-label="查看更早的一次运行"
                  disabled={effectiveRunIndex >= runs.length - 1}
                  onClick={() => dispatch({ type: 'select-run', runIndex: effectiveRunIndex + 1 })}
                >
                  <Icons.ChevronRight size={14} />
                </button>
              </div>
              <div
                className="canvas-operation-workbench-output-list"
                aria-label="可横向滚动的本次运行产物"
                tabIndex={0}
              >
                {outputs.length === 0 ? (
                  <span className="canvas-operation-workbench-output-list-empty">
                    本次运行无产物
                  </span>
                ) : (
                  outputs.map((output, index) => {
                    const selected = selectedOutputIdSet.has(output.id)
                    const primary = outputState.primaryOutput?.id === output.id
                    return (
                      <button
                        key={output.id}
                        type="button"
                        className={`${index === effectiveOutputIndex ? 'is-active' : ''}${selected ? ' is-selected' : ''}`}
                        aria-pressed={state.selectionMode ? selected : index === effectiveOutputIndex}
                        onClick={() => {
                          dispatch({ type: 'select-output', outputIndex: index })
                          if (state.selectionMode) {
                            dispatch({ type: 'toggle-output-selection', outputId: output.id })
                          }
                        }}
                      >
                        {state.selectionMode ? (
                          <span className="canvas-operation-output-check">{selected ? '✓' : ''}</span>
                        ) : null}
                        <span>{output.title}</span>
                        {primary ? (
                          <small>{outputState.mode === 'collection' ? '默认' : '主'}</small>
                        ) : null}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : null}
          {activeTab === 'output' && activeRun ? (
            <div className="canvas-operation-workbench-actions" aria-label="产物操作">
              {outputs.length > 1 ? (
                <Button
                  size="middle"
                  type={state.selectionMode ? 'primary' : 'text'}
                  icon={<Icons.Check size={13} />}
                  onClick={() => dispatch({ type: 'toggle-selection-mode' })}
                >
                  {state.selectionMode ? '退出多选' : '多选'}
                </Button>
              ) : null}
              <Popover
                trigger="click"
                placement="bottomRight"
                content={
                  <div className="canvas-operation-more-menu" aria-label="更多产物操作菜单">
                    <div className="canvas-operation-more-menu-summary">
                      <span className={`canvas-operation-more-menu-status is-${activeRun.status}`}>
                        {runStatusLabel(activeRun.status)}
                      </span>
                      <span>{OUTPUT_MODE_LABEL[outputState.mode]}</span>
                    </div>
                    <div className="canvas-operation-more-menu-actions">
                      {activeOutput && !isPrimaryOutput && onSetPrimaryOutput ? (
                        <button type="button" onClick={() => void onSetPrimaryOutput(activeOutput)}>
                          <Icons.Check size={14} />
                          <span>{primaryActionLabel}</span>
                        </button>
                      ) : null}
                      {activeOutput && onExpandOutputs ? (
                        <button
                          type="button"
                          disabled={state.busy}
                          onClick={() => void runExpansion([activeOutput])}
                        >
                          <Icons.Layers size={14} />
                          <span>展开当前产物</span>
                        </button>
                      ) : null}
                      {onExpandOutputs ? (
                        <>
                          <button
                            type="button"
                            disabled={state.busy}
                            onClick={() =>
                              void runExpansion(
                                selectCanvasOperationOutputs(runs, {
                                  scope: 'run',
                                  taskId: activeRun.taskId,
                                }),
                              )
                            }
                          >
                            <Icons.Layers size={14} />
                            <span>展开本次运行</span>
                          </button>
                          <button
                            type="button"
                            disabled={state.busy}
                            onClick={() =>
                              void runExpansion(
                                selectCanvasOperationOutputs(runs, { scope: 'all' }),
                              )
                            }
                          >
                            <Icons.Layers size={14} />
                            <span>展开全部历史</span>
                          </button>
                        </>
                      ) : null}
                      {canPreviewPanorama && outputNode && onPreviewPanoramaOutput ? (
                        <button
                          type="button"
                          onClick={() => onPreviewPanoramaOutput(outputNode.id)}
                        >
                          <Icons.Maximize size={14} />
                          <span>全景预览</span>
                        </button>
                      ) : null}
                      {canDownload && outputNode && onDownloadOutput ? (
                        <button type="button" onClick={() => onDownloadOutput(outputNode.id)}>
                          <Icons.Download size={14} />
                          <span>下载当前产物</span>
                        </button>
                      ) : null}
                      {activeOutput && onDeleteOutputs ? (
                        <button
                          type="button"
                          className="is-danger"
                          onClick={() => confirmOutputDeletion([activeOutput])}
                        >
                          <Icons.Trash size={14} />
                          <span>删除当前产物</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                }
              >
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.More size={14} />}
                  aria-label="更多产物操作"
                  title="更多产物操作"
                />
              </Popover>
              {activeOutputAssetId && onOpenAssetLibrary ? (
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Folder size={13} />}
                  onClick={() => onOpenAssetLibrary(activeOutputAssetId)}
                >
                  资源库
                </Button>
              ) : null}
              {outputNode ? (
                <Button
                  size="middle"
                  type={state.editingOutput ? 'default' : 'primary'}
                  icon={state.editingOutput ? <Icons.Eye size={13} /> : <Icons.Edit size={13} />}
                  onClick={() => dispatch({ type: 'toggle-editing' })}
                >
                  {state.editingOutput ? '返回预览' : '编辑产物'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {isLatestRunRunning ? (
        <div className="canvas-operation-workbench-run-banner" role="status" aria-live="polite">
          <div className="canvas-operation-workbench-run-banner-progress">
            <Progress percent={Math.round(latestRun?.progress ?? 0)} size="small" status="active" />
          </div>
          <div className="canvas-operation-workbench-run-banner-meta">
            <strong>
              第 {runs.length} 次任务运行中
              {latestRun?.modelId ? <span> · {latestRun.modelId}</span> : null}
            </strong>
            {runBannerParamSummary.length > 0 ? (
              <div className="canvas-operation-workbench-run-banner-params">
                {runBannerParamSummary.map((item) => (
                  <span key={item.key}>
                    {item.label} <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            size="small"
            type="primary"
            ghost
            onClick={() => dispatch({ type: 'select-tab', tab: 'config' })}
          >
            查看进度
          </Button>
        </div>
      ) : null}

      <div className="canvas-operation-workbench-content">
        {activeTab === 'settings' ? (
          <CanvasOperationNodeSettings
            key={`${node.id}:${node.title ?? ''}`}
            nodeId={node.id}
            title={node.title ?? null}
            disabled={state.busy}
            onRename={onRenameNode}
          />
        ) : activeTab === 'config' ? (
          configPanel
        ) : activeTab === 'history' ? (
          <div className="canvas-operation-history" aria-label="运行历史">
            {runs.map((run, index) => {
              const deletable =
                run.status === 'failed' ||
                run.status === 'cancelled' ||
                (run.outputs.length === 0 && run.status !== 'running')
              return (
                <div
                  key={run.taskId}
                  role="button"
                  tabIndex={0}
                  className={`canvas-operation-history-item${index === effectiveRunIndex ? ' is-active' : ''}`}
                  onClick={() => dispatch({ type: 'select-run', runIndex: index })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      dispatch({ type: 'select-run', runIndex: index })
                    }
                  }}
                >
                  <span className={`canvas-operation-history-status is-${run.status}`} />
                  <span className="canvas-operation-history-main">
                    <strong>第 {runs.length - index} 次运行</strong>
                    <small>{new Date(run.createdAt).toLocaleString()}</small>
                  </span>
                  <span>{run.provider ?? '自动 Provider'}</span>
                  <span>{run.modelId ?? '默认模型'}</span>
                  <span>{run.outputs.length} 个产物</span>
                  <Tag color={run.status === 'completed' ? 'green' : 'default'} bordered={false}>
                    {runStatusLabel(run.status)}
                  </Tag>
                  {deletable && onDeleteRun ? (
                    <button
                      type="button"
                      className="canvas-operation-history-delete"
                      aria-label="删除这次运行记录"
                      disabled={state.busy}
                      onClick={(event) => {
                        event.stopPropagation()
                        confirmRunDeletion(run)
                      }}
                    >
                      <Icons.Trash size={14} />
                    </button>
                  ) : (
                    <span
                      className="canvas-operation-history-delete-placeholder"
                      aria-hidden="true"
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : activeRun && activeOutput ? (
          <div className="canvas-operation-result-panel">
            {state.selectionMode ? (
              <div className="canvas-operation-selection-bar">
                <div className="canvas-operation-selection-summary">
                  <strong>已选择 {state.selectedOutputIds.length} 个</strong>
                  <span>本次运行共 {outputs.length} 个产物</span>
                </div>
                <div className="canvas-operation-selection-actions">
                  <Button
                    size="middle"
                    type="text"
                    disabled={state.busy}
                    onClick={() =>
                      dispatch({
                        type: 'set-output-selection',
                        outputIds: allCurrentRunSelected ? [] : outputs.map((output) => output.id),
                      })
                    }
                  >
                    {allCurrentRunSelected ? '取消全选' : '全选本次'}
                  </Button>
                  {onExpandOutputs ? (
                    <Button
                      size="middle"
                      type="default"
                      loading={state.busy}
                      disabled={selectedOutputs.length === 0}
                      onClick={() => void runExpansion(selectedOutputs)}
                    >
                      展开所选
                    </Button>
                  ) : null}
                  {onDeleteOutputs ? (
                    <Button
                      size="middle"
                      type="text"
                      danger
                      icon={<Icons.Trash size={13} />}
                      loading={state.busy}
                      disabled={selectedOutputs.length === 0}
                      onClick={() => confirmOutputDeletion(selectedOutputs)}
                    >
                      删除所选
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {state.editingOutput && outputNode ? (
              <div className="canvas-operation-workbench-editing">
                <CanvasNodeEditModal
                  node={outputNode}
                  open
                  assets={snapshot.assets}
                  tasks={snapshot.tasks}
                  nodes={snapshot.nodes}
                  placement="inline"
                  showInlineBack
                  {...(onFullscreenChange ? { fullscreen, onFullscreenChange } : {})}
                  onClose={() => dispatch({ type: 'toggle-editing' })}
                  onSave={async (targetNode, patch, data) => {
                    await onSaveOutput(targetNode, patch, data)
                    dispatch({ type: 'toggle-editing' })
                  }}
                />
              </div>
            ) : (
              <div className="canvas-operation-workbench-preview">
                <CanvasOperationOutputPreview output={activeOutput} variant="detail" />
              </div>
            )}
          </div>
        ) : activeRun ? (
          <div
            className={`canvas-operation-workbench-empty is-${activeRun.status}`}
            aria-label="本次运行结果"
          >
            <Tag
              color={
                activeRun.status === 'failed'
                  ? 'red'
                  : activeRun.status === 'running'
                    ? 'blue'
                    : 'default'
              }
              bordered
            >
              {runStatusLabel(activeRun.status)}
            </Tag>
            <strong>
              第 {runs.length - effectiveRunIndex} 次运行
              {activeRun.status === 'failed'
                ? '失败'
                : activeRun.status === 'cancelled'
                  ? '已取消'
                  : activeRun.status === 'running'
                    ? '进行中'
                    : '未生成产物'}
            </strong>
            {activeRun.status === 'failed' && activeRun.errorMsg ? (
              <p className="canvas-operation-workbench-empty-msg">{activeRun.errorMsg}</p>
            ) : null}
            {activeRun.status === 'failed' && activeRun.errorDetail ? (
              <details className="canvas-operation-workbench-empty-detail">
                <summary>详细错误</summary>
                <pre>{activeRun.errorDetail}</pre>
              </details>
            ) : null}
            {activeRun.status === 'failed' || activeRun.status === 'running' ? (
              <Button
                size="small"
                type="primary"
                onClick={() => dispatch({ type: 'select-tab', tab: 'config' })}
              >
                {activeRun.status === 'failed' ? '打开任务配置' : '查看任务配置'}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="canvas-operation-workbench-empty">当前任务还没有可展示的产物</div>
        )}
      </div>
    </div>
  )
}
