import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { Button, Tag, Tooltip } from '@lobehub/ui'
import { Modal, Popover } from 'antd'
import { Icons } from '../../Icons'
import { CanvasNodeEditModal } from './CanvasNodeEditModal'
import { CanvasOperationOutputPreview } from './CanvasOperationOutputPreview'
import {
  resolveCanvasOperationOutputState,
  selectCanvasOperationOutputs,
} from './canvasOperationOutputModel'
import {
  buildCanvasOperationRunViews,
  canvasOperationRunsFingerprint,
  type CanvasOperationOutputView,
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
  onSaveOutput,
  onDownloadOutput,
  onPreviewPanoramaOutput,
  onOpenAssetLibrary,
  onSetPrimaryOutput,
  onExpandOutputs,
  onDeleteOutputs,
}: {
  node: CanvasNode
  snapshot: CanvasSnapshot
  configPanel: ReactNode
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
}) {
  const runs = useMemo(() => buildCanvasOperationRunViews(node, snapshot), [node, snapshot])
  const outputState = useMemo(() => resolveCanvasOperationOutputState(node, runs), [node, runs])
  const outputCount = runs.reduce((total, run) => total + run.outputs.length, 0)
  const hasOutputs = outputCount > 0
  const [state, dispatch] = useReducer(
    reduceCanvasOperationWorkbenchState,
    undefined,
    () =>
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
  }, [hasOutputs, node.data.primaryOutputId, outputState.primaryOutputIndex, outputState.primaryRunIndex, runsFingerprint])

  const effectiveRunIndex = Math.min(state.runIndex, Math.max(0, runs.length - 1))
  const activeRun = runs[effectiveRunIndex]
  const outputs = activeRun?.outputs ?? []
  const effectiveOutputIndex = Math.min(state.outputIndex, Math.max(0, outputs.length - 1))
  const activeOutput = outputs[effectiveOutputIndex]
  const outputNode = activeOutput?.nodeId
    ? (snapshot.nodes.find((item) => item.id === activeOutput.nodeId) ?? null)
    : null
  const activeTab: CanvasOperationWorkbenchTab = hasOutputs ? state.tab : 'config'
  const selectedOutputIdSet = new Set(state.selectedOutputIds)
  const selectedOutputs = outputs.filter((output) => selectedOutputIdSet.has(output.id))
  const allCurrentRunSelected =
    outputs.length > 0 && outputs.every((output) => selectedOutputIdSet.has(output.id))
  const displayRunNumber = activeRun ? runs.length - effectiveRunIndex : 0
  const canDownload = Boolean(outputNode && (activeOutput?.type === 'image' || activeOutput?.type === 'video'))
  const canPreviewPanorama = Boolean(outputNode && activeOutput?.panorama360)
  const isPrimaryOutput = Boolean(
    activeOutput && outputState.primaryOutput && activeOutput.id === outputState.primaryOutput.id,
  )
  const primaryActionLabel = outputState.mode === 'collection' ? '设为默认预览' : '设为主产物'

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

  const tabButton = (tab: CanvasOperationWorkbenchTab, label: string, icon: ReactNode, count?: number) => (
    <button
      type="button"
      className={`canvas-operation-workbench-tab${activeTab === tab ? ' is-active' : ''}`}
      disabled={tab !== 'config' && !hasOutputs}
      onClick={() => dispatch({ type: 'select-tab', tab })}
    >
      {icon}
      {label}
      {count ? <span className="canvas-operation-workbench-count">{count}</span> : null}
    </button>
  )

  return (
    <div className="canvas-operation-workbench">
      <div className="canvas-operation-workbench-head">
        <div className="canvas-operation-workbench-tabs">
          {tabButton('output', '产物', <Icons.File size={13} />, outputCount)}
          {tabButton('history', '运行历史', <Icons.RotateCcw size={13} />, runs.length)}
          {tabButton('config', '任务配置', <Icons.Settings size={13} />)}
        </div>
        {activeTab === 'output' && activeRun ? (
          <div className="canvas-operation-workbench-actions">
            <Tag color={activeRun.status === 'completed' ? 'green' : 'default'} bordered={false}>
              {runStatusLabel(activeRun.status)}
            </Tag>
            <Tag bordered={false}>{OUTPUT_MODE_LABEL[outputState.mode]}</Tag>
            {activeOutput && !isPrimaryOutput && onSetPrimaryOutput ? (
              <Button
                size="middle"
                type="text"
                icon={<Icons.Check size={13} />}
                onClick={() => void onSetPrimaryOutput(activeOutput)}
              >
                {primaryActionLabel}
              </Button>
            ) : null}
            {activeOutput && onExpandOutputs ? (
              <Button
                size="middle"
                type="text"
                loading={state.busy}
                icon={<Icons.Layers size={13} />}
                onClick={() => void runExpansion([activeOutput])}
              >
                展开当前
              </Button>
            ) : null}
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
            {onExpandOutputs || (activeOutput && onDeleteOutputs) ? (
              <Popover
                trigger="click"
                placement="bottomRight"
                content={
                  <div className="canvas-operation-expand-menu">
                    {onExpandOutputs ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void runExpansion(
                              activeRun
                                ? selectCanvasOperationOutputs(runs, {
                                    scope: 'run',
                                    taskId: activeRun.taskId,
                                  })
                                : [],
                            )
                          }
                        >
                          展开本次运行
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runExpansion(selectCanvasOperationOutputs(runs, { scope: 'all' }))
                          }
                        >
                          展开全部历史
                        </button>
                      </>
                    ) : null}
                    {activeOutput && onDeleteOutputs ? (
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => confirmOutputDeletion([activeOutput])}
                      >
                        删除当前产物
                      </button>
                    ) : null}
                  </div>
                }
              >
                <Button size="middle" type="text" icon={<Icons.More size={14} />} aria-label="更多产物操作" />
              </Popover>
            ) : null}
            {canPreviewPanorama && outputNode && onPreviewPanoramaOutput ? (
              <Button
                size="middle"
                type="text"
                icon={<Icons.Maximize size={13} />}
                onClick={() => onPreviewPanoramaOutput(outputNode.id)}
              >
                全景预览
              </Button>
            ) : null}
            {canDownload && outputNode && onDownloadOutput ? (
              <Tooltip title="下载当前产物">
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Download size={14} />}
                  aria-label="下载当前产物"
                  onClick={() => onDownloadOutput(outputNode.id)}
                />
              </Tooltip>
            ) : null}
            {activeOutput?.assetId && onOpenAssetLibrary ? (
              <Button
                size="middle"
                type="text"
                icon={<Icons.Folder size={13} />}
                onClick={() => onOpenAssetLibrary(activeOutput.assetId!)}
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

      <div className="canvas-operation-workbench-content">
        {activeTab === 'config' ? (
          configPanel
        ) : activeTab === 'history' ? (
          <div className="canvas-operation-history" aria-label="运行历史">
            {runs.map((run, index) => (
              <button
                key={run.taskId}
                type="button"
                className={index === effectiveRunIndex ? 'is-active' : ''}
                onClick={() => dispatch({ type: 'select-run', runIndex: index })}
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
              </button>
            ))}
          </div>
        ) : activeRun && activeOutput ? (
          <div className="canvas-operation-result-panel">
            <div className="canvas-operation-workbench-nav">
              <div className="canvas-operation-workbench-run-nav">
                <button
                  type="button"
                  aria-label="查看更新的一次运行"
                  disabled={effectiveRunIndex === 0}
                  onClick={() => dispatch({ type: 'select-run', runIndex: effectiveRunIndex - 1 })}
                >
                  <Icons.ChevronLeft size={14} />
                </button>
                <span>第 {displayRunNumber} 次运行{runs.length > 1 ? ` / 共 ${runs.length} 次` : ''}</span>
                <button
                  type="button"
                  aria-label="查看更早的一次运行"
                  disabled={effectiveRunIndex >= runs.length - 1}
                  onClick={() => dispatch({ type: 'select-run', runIndex: effectiveRunIndex + 1 })}
                >
                  <Icons.ChevronRight size={14} />
                </button>
              </div>
              <div className="canvas-operation-workbench-output-list" aria-label="本次运行产物">
                {outputs.map((output, index) => {
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
                      {state.selectionMode ? <span className="canvas-operation-output-check">{selected ? '✓' : ''}</span> : null}
                      <span>{output.title}</span>
                      {primary ? <small>{outputState.mode === 'collection' ? '默认' : '主'}</small> : null}
                    </button>
                  )
                })}
              </div>
            </div>

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
                  placement="inline"
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
        ) : (
          <div className="canvas-operation-workbench-empty">当前任务还没有可展示的产物</div>
        )}
      </div>
    </div>
  )
}
